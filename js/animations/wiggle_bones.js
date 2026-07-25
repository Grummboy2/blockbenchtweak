// ═══════════════════════════════════════════════════════════════
// WIGGLE BONES — Spring-based secondary motion for bones
//
// Each bone stores a position + rotation offset from its animated
// target. A spring-damper system pulls the offset back to zero,
// creating a jiggle / follow-through effect.
//
// Architecture:
//   WiggleBone   — physics state for a single bone
//   WiggleSystem — manager that owns all bones, handles ordering
//
// All tunable properties live on the Group object (serialized to
// project files). They are synced into the physics objects before
// each update via `syncFromGroup()`.
// ═══════════════════════════════════════════════════════════════

import { THREE } from '../lib/libs';

// ── Shared scratch objects (avoid per-frame allocations) ──────
const _scratch = new THREE.Vector3();

// ── Default property values ──────────────────────────────────
const DEFAULTS = {
	stiffness:          50,
	damping:             5,
	mass:                1,
	stiffness_rotation: 50,
	damping_rotation:    5,
	inertia:             1,
	max_angle:          45,
	max_distance:        2,
	collision_radius:    0,
	gravity:            true,
	gravity_vector:      [0, -9.81, 0],
	blend:               1,
	air_drag:            0,
	turbulence:          0,
	turbulence_speed:    5,
	chain:              false,
};

// ── Presets ──────────────────────────────────────────────────
// Each preset overrides a subset of properties. `null` = custom.
export const WIGGLE_PRESETS = {
	custom: null,
	hair: {
		stiffness: 30, damping: 3, mass: 0.5,
		stiffness_rotation: 20, damping_rotation: 2, inertia: 0.8,
		max_angle: 60, max_distance: 3,
		air_drag: 0.1, turbulence: 0,
	},
	tail: {
		stiffness: 40, damping: 4, mass: 0.8,
		stiffness_rotation: 30, damping_rotation: 3, inertia: 1,
		max_angle: 50, max_distance: 2.5,
		air_drag: 0.05, turbulence: 0,
	},
	cloth: {
		stiffness: 15, damping: 2, mass: 0.3,
		stiffness_rotation: 10, damping_rotation: 1.5, inertia: 0.5,
		max_angle: 80, max_distance: 4,
		air_drag: 0.15, turbulence: 0.5,
	},
	jelly: {
		stiffness: 60, damping: 8, mass: 1.5,
		stiffness_rotation: 55, damping_rotation: 7, inertia: 1.2,
		max_angle: 30, max_distance: 1.5,
		air_drag: 0, turbulence: 0,
	},
	heavy: {
		stiffness: 80, damping: 15, mass: 3,
		stiffness_rotation: 70, damping_rotation: 12, inertia: 1.5,
		max_angle: 20, max_distance: 0.8,
		air_drag: 0, turbulence: 0,
	},
	floppy: {
		stiffness: 10, damping: 1, mass: 0.2,
		stiffness_rotation: 8, damping_rotation: 0.8, inertia: 0.4,
		max_angle: 90, max_distance: 5,
		air_drag: 0.2, turbulence: 1,
	},
};

// ── Group → WiggleBone property mapping ──────────────────────
// Maps `group.wiggle_X` → `wiggleBone.X` with a default value.
// Used by syncFromGroup() to avoid manual copy-paste.
const PROP_MAP = [
	['wiggle_bone',              'enabled',            v => !!v,                      false],
	['wiggle_stiffness',         'stiffness',          v => Math.max(0, +v || 0),     DEFAULTS.stiffness],
	['wiggle_damping',           'damping',            v => Math.max(0, +v || 0),     DEFAULTS.damping],
	['wiggle_mass',              'mass',               v => Math.max(0.01, +v || 1),  DEFAULTS.mass],
	['wiggle_stiffness_rotation','stiffness_rotation', v => Math.max(0, +v || 0),     DEFAULTS.stiffness_rotation],
	['wiggle_damping_rotation',  'damping_rotation',   v => Math.max(0, +v || 0),     DEFAULTS.damping_rotation],
	['wiggle_inertia',           'inertia',            v => Math.max(0, +v || 0),     DEFAULTS.inertia],
	['wiggle_max_angle',         'max_angle',          v => Math.max(1, +v || 45),    DEFAULTS.max_angle],
	['wiggle_max_distance',      'max_distance',       v => Math.max(0, +v || 0),     DEFAULTS.max_distance],
	['wiggle_collision_radius',  'collision_radius',   v => Math.max(0, +v || 0),     DEFAULTS.collision_radius],
	['wiggle_gravity',           'gravity_enabled',    v => !!v,                       true],
	['wiggle_gravity_vector',    'gravity_vector',     v => v || [0, -9.81, 0],        [0, -9.81, 0]],
	['wiggle_blend',             'blend',              v => Math.clamp(+v || 1, 0, 1), 1],
	['wiggle_air_drag',          'air_drag',           v => Math.max(0, +v || 0),     DEFAULTS.air_drag],
	['wiggle_turbulence',        'turbulence',         v => Math.max(0, +v || 0),     DEFAULTS.turbulence],
	['wiggle_turbulence_speed',  'turbulence_speed',   v => Math.max(0.1, +v || 5),   DEFAULTS.turbulence_speed],
	['wiggle_chain',             'chain',              v => !!v,                       false],
];


// ═══════════════════════════════════════════════════════════════
// WiggleBone — physics for a single bone
// ═══════════════════════════════════════════════════════════════

class WiggleBone {
	constructor(group) {
		this.group = group;

		// Current physics parameters (synced from Group before each update)
		this.enabled            = false;
		this.blend              = 1;
		this.stiffness          = DEFAULTS.stiffness;
		this.damping            = DEFAULTS.damping;
		this.mass               = DEFAULTS.mass;
		this.stiffness_rotation = DEFAULTS.stiffness_rotation;
		this.damping_rotation   = DEFAULTS.damping_rotation;
		this.inertia            = DEFAULTS.inertia;
		this.max_angle          = DEFAULTS.max_angle;
		this.max_distance       = DEFAULTS.max_distance;
		this.collision_radius   = DEFAULTS.collision_radius;
		this.gravity_enabled    = true;
		this.gravity_vector     = [0, -9.81, 0];
		this.air_drag           = 0;
		this.turbulence         = 0;
		this.turbulence_speed   = 5;
		this.chain              = false;

		// Internal physics state
		this._velocity          = new THREE.Vector3();
		this._angular_velocity  = new THREE.Vector3();
		this._position_offset   = new THREE.Vector3();
		this._rotation_offset   = new THREE.Vector3();
		this._target_position   = new THREE.Vector3();
		this._target_rotation   = new THREE.Euler();
		this._turbulence        = new THREE.Vector3();
		this._time              = Math.random() * 100;
		this._initialized       = false;
	}

	// Reset all physics state to zero (used when preview starts/stops)
	reset() {
		this._velocity.set(0, 0, 0);
		this._angular_velocity.set(0, 0, 0);
		this._position_offset.set(0, 0, 0);
		this._rotation_offset.set(0, 0, 0);
		this._turbulence.set(0, 0, 0);
		this._initialized = false;
		this._time = Math.random() * 100;
	}

	// Capture the current animated position/rotation as the spring target.
	// Call this AFTER the animation system has posed the bone, but BEFORE update().
	setTargetFromCurrent() {
		const mesh = this.group?.mesh;
		if (!mesh) return;
		this._target_position.copy(mesh.position);
		this._target_rotation.copy(mesh.rotation);
	}

	// Run one frame of spring physics. Returns the position offset for
	// child bones to inherit when chain=true.
	//   delta_time — seconds since last frame (typically ~1/30)
	//   parent_offset — THREE.Vector3 from parent's wiggle, or null
	update(delta_time, parent_offset) {
		if (!this.enabled || !this.group?.mesh) return null;
		if (this.blend <= 0.001) return this._position_offset;

		const mesh = this.group.mesh;

		// First-frame initialization: snap to rest, no spring force yet
		if (!this._initialized) {
			this._position_offset.set(0, 0, 0);
			this._rotation_offset.set(0, 0, 0);
			this._velocity.set(0, 0, 0);
			this._angular_velocity.set(0, 0, 0);
			this._initialized = true;
			return this._position_offset;
		}

		// Substep the physics for stability
		const total_dt = Math.min(delta_time, 0.1);
		const substeps = Math.max(1, Math.ceil(total_dt * 60));
		const dt = total_dt / substeps;

		// Cache frequently accessed values
		const stiff        = this.stiffness;
		const damp         = this.damping;
		const mass         = Math.max(0.01, this.mass);
		const max_angle_rad = this.max_angle * Math.PI / 180;
		const max_dist     = this.max_distance;
		const drag         = this.air_drag;
		const turb_amt     = this.turbulence;
		const turb_speed   = this.turbulence_speed;
		const blend        = this.blend;
		const pos_offset   = this._position_offset;
		const rot_offset   = this._rotation_offset;
		const vel          = this._velocity;
		const angular_vel  = this._angular_velocity;
		const target_pos   = this._target_position;

		// ── Position spring (per substep) ────────────────────
		for (let i = 0; i < substeps; i++) {
			this._time += dt;

			// Turbulence: pseudo-3D noise via layered sin waves
			if (turb_amt > 0) {
				const t = this._time * turb_speed;
				this._turbulence.set(
					Math.sin(t * 1.1 + 0.7) * Math.sin(t * 0.7 + 1.3) * turb_amt,
					Math.sin(t * 0.9 + 2.1) * Math.sin(t * 1.3 + 0.3) * turb_amt,
					Math.sin(t * 1.2 + 1.1) * Math.sin(t * 0.8 + 2.7) * turb_amt
				);
			}

			// Effective target = animated position + parent chain offset + turbulence
			const tx = target_pos.x + (this.chain && parent_offset ? parent_offset.x : 0) + this._turbulence.x;
			const ty = target_pos.y + (this.chain && parent_offset ? parent_offset.y : 0) + this._turbulence.y;
			const tz = target_pos.z + (this.chain && parent_offset ? parent_offset.z : 0) + this._turbulence.z;

			// Spring displacement: difference between effective target and where the bone actually is
			const dx = tx - (target_pos.x + pos_offset.x);
			const dy = ty - (target_pos.y + pos_offset.y);
			const dz = tz - (target_pos.z + pos_offset.z);

			// Acceleration = spring restoring force + damping + gravity + drag
			//   spring:  F = (displacement) * stiffness / mass
			//   damping: F = -velocity * damping_coeff / mass
			const spring_k = stiff / mass;
			const damp_k   = damp / mass;

			let ax = dx * spring_k - vel.x * damp_k;
			let ay = dy * spring_k - vel.y * damp_k;
			let az = dz * spring_k - vel.z * damp_k;

			// Gravity
			if (this.gravity_enabled) {
				ax += this.gravity_vector[0];
				ay += this.gravity_vector[1];
				az += this.gravity_vector[2];
			}

			// Air drag (proportional to speed squared, opposes velocity)
			if (drag > 0) {
				const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
				if (speed > 0.0001) {
					const drag_force = drag * speed;
					ax -= (vel.x / speed) * drag_force;
					ay -= (vel.y / speed) * drag_force;
					az -= (vel.z / speed) * drag_force;
				}
			}

			// Semi-implicit Euler integration
			vel.x += ax * dt;
			vel.y += ay * dt;
			vel.z += az * dt;

			pos_offset.x += vel.x * dt;
			pos_offset.y += vel.y * dt;
			pos_offset.z += vel.z * dt;
		}

		// Clamp position offset to max_distance
		if (max_dist > 0) {
			const len = Math.sqrt(pos_offset.x * pos_offset.x + pos_offset.y * pos_offset.y + pos_offset.z * pos_offset.z);
			if (len > max_dist) {
				const s = max_dist / len;
				pos_offset.x *= s;
				pos_offset.y *= s;
				pos_offset.z *= s;
			}
		}

		// Apply blended position offset
		mesh.position.x = target_pos.x + pos_offset.x * blend;
		mesh.position.y = target_pos.y + pos_offset.y * blend;
		mesh.position.z = target_pos.z + pos_offset.z * blend;

		// ── Rotation spring (per substep) ───────────────────
		const rot_stiff = this.stiffness_rotation * this.inertia;
		const rot_damp  = this.damping_rotation * this.inertia;
		const rot_mass  = mass;
		const target_rot = this._target_rotation;

		for (let i = 0; i < substeps; i++) {
			const drx = target_rot.x - rot_offset.x;
			const dry = target_rot.y - rot_offset.y;
			const drz = target_rot.z - rot_offset.z;

			const rk = rot_stiff / rot_mass;
			const rd = rot_damp / rot_mass;

			angular_vel.x += (drx * rk - angular_vel.x * rd) * dt;
			angular_vel.y += (dry * rk - angular_vel.y * rd) * dt;
			angular_vel.z += (drz * rk - angular_vel.z * rd) * dt;

			rot_offset.x += angular_vel.x * dt;
			rot_offset.y += angular_vel.y * dt;
			rot_offset.z += angular_vel.z * dt;
		}

		// Clamp rotation offset to max_angle
		if (max_angle_rad > 0) {
			const rlen = Math.sqrt(rot_offset.x * rot_offset.x + rot_offset.y * rot_offset.y + rot_offset.z * rot_offset.z);
			if (rlen > max_angle_rad) {
				const s = max_angle_rad / rlen;
				rot_offset.x *= s;
				rot_offset.y *= s;
				rot_offset.z *= s;
			}
		}

		// Apply blended rotation offset
		mesh.rotation.set(
			target_rot.x + rot_offset.x * blend,
			target_rot.y + rot_offset.y * blend,
			target_rot.z + rot_offset.z * blend,
			mesh.rotation.order
		);

		mesh.updateMatrixWorld(true);

		// Collision: push bone back if it penetrates ground/ceiling
		if (this.collision_radius > 0) {
			this._handleCollision(mesh);
		}

		return pos_offset;
	}

	_handleCollision(mesh) {
		const world_pos = _scratch.copy(mesh.position);
		if (mesh.parent) mesh.parent.localToWorld(world_pos);

		const r = this.collision_radius;
		let hit = false;

		if (world_pos.y < -r) {
			world_pos.y = -r;
			this._velocity.y *= -0.3;
			this._angular_velocity.multiplyScalar(0.7);
			hit = true;
		} else if (world_pos.y > 64 + r) {
			world_pos.y = 64 + r;
			this._velocity.y *= -0.3;
			hit = true;
		}

		if (hit && mesh.parent) {
			mesh.parent.worldToLocal(world_pos);
			mesh.position.copy(world_pos);
		}
	}
}


// ═══════════════════════════════════════════════════════════════
// WiggleSystem — manages all WiggleBone instances
// ═══════════════════════════════════════════════════════════════

class WiggleSystem {
	constructor() {
		this._bones = new Map(); // uuid → WiggleBone
	}

	// Get or create the WiggleBone for a Group
	getOrCreate(group) {
		if (!this._bones.has(group.uuid)) {
			this._bones.set(group.uuid, new WiggleBone(group));
		}
		return this._bones.get(group.uuid);
	}

	// Remove a Group's WiggleBone
	remove(group) {
		this._bones.delete(group.uuid);
	}

	// Check if a group has a registered WiggleBone
	has(group) {
		return this._bones.has(group.uuid);
	}

	// Copy all properties from the Group object into the WiggleBone.
	// Uses PROP_MAP so adding new properties is just one line.
	syncFromGroup(group) {
		const bone = this.getOrCreate(group);
		for (const [groupKey, boneKey, transform, fallback] of PROP_MAP) {
			bone[boneKey] = transform(group[groupKey] ?? fallback);
		}
		return bone;
	}

	// Apply a named preset to a Group's properties
	applyPreset(group, preset_name) {
		const preset = WIGGLE_PRESETS[preset_name];
		if (!preset) return;

		for (const [key, value] of Object.entries(preset)) {
			const group_key = 'wiggle_' + key;
			if (group_key in group) {
				group[group_key] = value;
			}
		}
	}

	// Detect which preset (if any) matches a Group's current settings
	detectPreset(group) {
		for (const [name, preset] of Object.entries(WIGGLE_PRESETS)) {
			if (!preset) continue;
			let match = true;
			for (const [key, value] of Object.entries(preset)) {
				if (group['wiggle_' + key] !== value) { match = false; break; }
			}
			if (match) return name;
		}
		return 'custom';
	}

	// Update all bones for one frame. Call AFTER animation has posed the bones.
	//   delta_time — seconds since last frame
	update(delta_time) {
		const ordered = this._getUpdateOrder();

		for (const bone of ordered) {
			if (!bone.enabled || !bone.group?.mesh || bone.blend <= 0.001) continue;

			let parent_offset = null;
			if (bone.chain) {
				parent_offset = this._findParentOffset(bone.group);
			}

			bone.update(delta_time, parent_offset);
		}
	}

	// Walk up the hierarchy to find the nearest parent's wiggle offset
	_findParentOffset(group) {
		let node = group.parent;
		while (node) {
			const parent_bone = this._bones.get(node.uuid);
			if (parent_bone?.enabled) return parent_bone._position_offset;
			node = node.parent;
		}
		return null;
	}

	// Sort bones by tree depth so parents update before children
	_getUpdateOrder() {
		const bones = Array.from(this._bones.values());
		bones.sort((a, b) => this._getDepth(a.group) - this._getDepth(b.group));
		return bones;
	}

	_getDepth(group) {
		let depth = 0;
		let node = group.parent;
		while (node) { depth++; node = node.parent; }
		return depth;
	}

	// Reset all bones to zero offset
	reset() {
		for (const bone of this._bones.values()) {
			bone.reset();
		}
	}

	// Capture current animated pose as the spring target for all bones
	setTargetsFromCurrent() {
		for (const bone of this._bones.values()) {
			bone.setTargetFromCurrent();
		}
	}
}


// ═══════════════════════════════════════════════════════════════
// Singleton export
// ═══════════════════════════════════════════════════════════════

export const WiggleBones = new WiggleSystem();

// Expose globally so group.js can access without import (avoids circular deps)
Object.assign(window, { WiggleBones, WIGGLE_PRESETS });
