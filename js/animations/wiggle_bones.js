import { THREE } from '../lib/libs';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e1 = new THREE.Euler();

class WiggleBone {
	constructor(group) {
		this.group = group;
		this.enabled = false;

		this.stiffness = 50;
		this.damping = 5;
		this.mass = 1;
		this.stiffness_rotation = 50;
		this.damping_rotation = 5;
		this.inertia = 1;
		this.max_angle = 45;
		this.max_distance = 2;
		this.collision_radius = 0;
		this.gravity_enabled = true;
		this.gravity_vector = [0, -9.81, 0];

		this._velocity = new THREE.Vector3();
		this._angular_velocity = new THREE.Vector3();
		this._target_position = new THREE.Vector3();
		this._target_rotation = new THREE.Euler();
		this._current_offset = new THREE.Vector3();
		this._current_rot_offset = new THREE.Euler();
		this._initialized = false;
	}

	reset() {
		this._velocity.set(0, 0, 0);
		this._angular_velocity.set(0, 0, 0);
		this._current_offset.set(0, 0, 0);
		this._current_rot_offset.set(0, 0, 0);
		this._initialized = false;
	}

	setTargetFromCurrent() {
		if (!this.group || !this.group.mesh) return;
		const mesh = this.group.mesh;
		this._target_position.copy(mesh.position);
		this._target_rotation.copy(mesh.rotation);
	}

	update(delta_time) {
		if (!this.enabled || !this.group || !this.group.mesh) return;

		const mesh = this.group.mesh;

		if (!this._initialized) {
			this._current_offset.set(0, 0, 0);
			this._current_rot_offset.set(0, 0, 0);
			this._velocity.set(0, 0, 0);
			this._angular_velocity.set(0, 0, 0);
			this._initialized = true;
			return;
		}

		const dt = Math.min(delta_time, 1/20);
		const stiffness = this.stiffness;
		const damping = this.damping;
		const mass = this.mass;
		const max_angle_rad = Math.degToRad(this.max_angle);
		const max_dist = this.max_distance;

		const target_pos = this._target_position;
		const target_rot = this._target_rotation;

		const base_pos = target_pos.clone().sub(this._current_offset);
		const base_rot = new THREE.Euler(
			target_rot.x - this._current_rot_offset.x,
			target_rot.y - this._current_rot_offset.y,
			target_rot.z - this._current_rot_offset.z,
			target_rot.order
		);

		const current_offset = this._current_offset;

		_v1.copy(target_pos).sub(base_pos).add(current_offset);
		const displacement = _v1.clone();

		const spring_force = stiffness * mass;
		const damping_force = damping * mass;

		const accel = _v2.copy(displacement).multiplyScalar(-spring_force);
		accel.add(this._velocity.clone().multiplyScalar(-damping_force));

		if (this.gravity_enabled) {
			accel.x += this.gravity_vector[0] * mass;
			accel.y += this.gravity_vector[1] * mass;
			accel.z += this.gravity_vector[2] * mass;
		}

		this._velocity.add(accel.multiplyScalar(dt));
		current_offset.add(this._velocity.clone().multiplyScalar(dt));

		if (current_offset.length() > max_dist) {
			current_offset.setLength(max_dist);
		}

		mesh.position.copy(base_pos).add(current_offset);

		const rot_stiffness = this.stiffness_rotation;
		const rot_damping = this.damping_rotation;
		const rot_inertia = this.inertia;

		const current_rot_offset = this._current_rot_offset;

		const angle_diff = _v1.set(
			target_rot.x - base_rot.x - current_rot_offset.x,
			target_rot.y - base_rot.y - current_rot_offset.y,
			target_rot.z - base_rot.z - current_rot_offset.z
		);

		const rot_accel = _v2.copy(angle_diff).multiplyScalar(-rot_stiffness * rot_inertia);
		rot_accel.add(this._angular_velocity.clone().multiplyScalar(-rot_damping * rot_inertia));

		this._angular_velocity.add(rot_accel.multiplyScalar(dt));
		current_rot_offset.add(this._angular_velocity.clone().multiplyScalar(dt));

		const rot_len = Math.sqrt(
			current_rot_offset.x ** 2 +
			current_rot_offset.y ** 2 +
			current_rot_offset.z ** 2
		);
		if (rot_len > max_angle_rad) {
			current_rot_offset.x = (current_rot_offset.x / rot_len) * max_angle_rad;
			current_rot_offset.y = (current_rot_offset.y / rot_len) * max_angle_rad;
			current_rot_offset.z = (current_rot_offset.z / rot_len) * max_angle_rad;
		}

		mesh.rotation.set(
			base_rot.x + current_rot_offset.x,
			base_rot.y + current_rot_offset.y,
			base_rot.z + current_rot_offset.z,
			target_rot.order
		);

		mesh.updateMatrixWorld(true);

		if (this.collision_radius > 0) {
			this._handleCollisions(mesh);
		}
	}

	_handleCollisions(mesh) {
		const world_pos = mesh.getWorldPosition(_v1);
		const radius = this.collision_radius;
		let collided = false;

		if (world_pos.y < -radius) {
			world_pos.y = -radius;
			this._velocity.y *= -0.3;
			this._angular_velocity.multiplyScalar(0.7);
			collided = true;
		}
		if (world_pos.y > 64 + radius) {
			world_pos.y = 64 + radius;
			this._velocity.y *= -0.3;
			collided = true;
		}

		if (collided && mesh.parent) {
			mesh.parent.worldToLocal(world_pos);
			mesh.position.copy(world_pos);
		}
	}
}

class WiggleBoneSystem {
	constructor() {
		this.wiggle_bones = new Map();
	}

	getWiggleBone(group) {
		if (!this.wiggle_bones.has(group.uuid)) {
			this.wiggle_bones.set(group.uuid, new WiggleBone(group));
		}
		return this.wiggle_bones.get(group.uuid);
	}

	removeWiggleBone(group) {
		this.wiggle_bones.delete(group.uuid);
	}

	update(delta_time) {
		for (let [uuid, wiggle_bone] of this.wiggle_bones) {
			if (wiggle_bone.enabled && wiggle_bone.group && wiggle_bone.group.mesh) {
				wiggle_bone.update(delta_time);
			}
		}
	}

	reset() {
		for (let [uuid, wiggle_bone] of this.wiggle_bones) {
			wiggle_bone.reset();
		}
	}

	setTargetsFromCurrent() {
		for (let [uuid, wiggle_bone] of this.wiggle_bones) {
			wiggle_bone.setTargetFromCurrent();
		}
	}

	syncFromGroup(group) {
		const wiggle = this.getWiggleBone(group);
		wiggle.enabled = group.wiggle_bone;
		wiggle.stiffness = group.wiggle_stiffness ?? 50;
		wiggle.damping = group.wiggle_damping ?? 5;
		wiggle.mass = group.wiggle_mass ?? 1;
		wiggle.stiffness_rotation = group.wiggle_stiffness_rotation ?? 50;
		wiggle.damping_rotation = group.wiggle_damping_rotation ?? 5;
		wiggle.inertia = group.wiggle_inertia ?? 1;
		wiggle.max_angle = group.wiggle_max_angle ?? 45;
		wiggle.max_distance = group.wiggle_max_distance ?? 2;
		wiggle.collision_radius = group.wiggle_collision_radius ?? 0;
		wiggle.gravity_enabled = group.wiggle_gravity ?? true;
		wiggle.gravity_vector = group.wiggle_gravity_vector ?? [0, -9.81, 0];
		return wiggle;
	}

	getAllWiggleBones() {
		return Array.from(this.wiggle_bones.values());
	}
}

export const WiggleBones = new WiggleBoneSystem();
export { WiggleBone, WiggleBoneSystem };