// ═══════════════════════════════════════════════════════════════
// WIGGLE BONES — UI Panel Component
//
// Vue component for the bone properties panel. Renders when a
// bone is selected in animate mode on a format that supports
// wiggle bones.
//
// Uses `data` (not `computed`) for `Format` checks because
// Blockbench's `Format` getter isn't reactive in Vue.
// ═══════════════════════════════════════════════════════════════

import { WiggleBones, WIGGLE_PRESETS } from './wiggle_bones';

// ── Helper: single slider row ────────────────────────────────
// Renders: label | range input | value display
// Returns a template string to keep the main template cleaner.
function slider(prop, label, min, max, step, unit = '') {
	return `
		<div class="dialog_bar" style="padding: 2px 12px;">
			<label class="name_space_left" style="min-width: 90px;">${label}:</label>
			<input type="range" min="${min}" max="${max}" step="${step}"
				:value="group.${prop}"
				@input="setProp('${prop}', $event.target.value)"
				style="flex: 1;">
			<span style="min-width: 40px; text-align: right;">{{ group.${prop} }}${unit}</span>
		</div>`;
}

// ── Collapsible section wrapper ──────────────────────────────
function section(key, title, content) {
	return `
		<div style="border-top: 1px solid var(--color-border); margin: 6px 12px; cursor: pointer;"
			@click="sections.${key} = !sections.${key}">
			<p class="panel_toolbar_label" style="margin-top: 4px; font-size: 0.85em; opacity: 0.7; display: flex; justify-content: space-between;">
				<span>${title}</span>
				<span>{{ sections.${key} ? '▾' : '▸' }}</span>
			</p>
		</div>
		<template v-if="sections.${key}">${content}</template>`;
}


// ═══════════════════════════════════════════════════════════════
// Exported Vue component definition
// ═══════════════════════════════════════════════════════════════

export function createWigglePanelComponent() {
	return {
		template: `
			<div>
				<p class="panel_toolbar_label">${tl('panel.element.origin')}</p>
				<div class="toolbar_wrapper bone_origin"></div>

				<div v-if="show_wiggle" style="border-top: 1px solid var(--color-border); margin: 8px 0; padding-top: 8px;">

					<!-- Enable + Preset -->
					<div class="dialog_bar" style="padding: 4px 12px;">
						<label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
							<input type="checkbox" :checked="group.wiggle_bone" @change="toggleWiggle">
							<span style="font-weight: 500;">Wiggle Bone</span>
						</label>
					</div>

					<template v-if="group.wiggle_bone">
						<div class="dialog_bar" style="padding: 2px 12px;">
							<label class="name_space_left" style="min-width: 90px;">Preset:</label>
							<select :value="preset" @change="applyPreset($event.target.value)" style="flex: 1;">
								<option value="custom">Custom</option>
								<option value="hair">Hair</option>
								<option value="tail">Tail</option>
								<option value="cloth">Cloth</option>
								<option value="jelly">Jelly</option>
								<option value="heavy">Heavy</option>
								<option value="floppy">Floppy</option>
							</select>
						</div>

						${slider('wiggle_blend', 'Blend', 0, 1, 0.05, '%')}

						${section('spring', 'Spring', `
							${slider('wiggle_stiffness', 'Stiffness', 0, 200, 1)}
							${slider('wiggle_damping', 'Damping', 0, 100, 0.5)}
							${slider('wiggle_mass', 'Mass', 0.01, 10, 0.05)}
						`)}

						${section('rotation', 'Rotation', `
							${slider('wiggle_stiffness_rotation', 'Stiffness', 0, 200, 1)}
							${slider('wiggle_damping_rotation', 'Damping', 0, 100, 0.5)}
							${slider('wiggle_inertia', 'Inertia', 0, 5, 0.1)}
						`)}

						${section('limits', 'Limits', `
							${slider('wiggle_max_angle', 'Max Angle', 1, 180, 1, '°')}
							${slider('wiggle_max_distance', 'Max Dist', 0, 20, 0.1)}
							${slider('wiggle_collision_radius', 'Collision', 0, 10, 0.1)}
						`)}

						${section('environment', 'Environment', `
							<div class="dialog_bar" style="padding: 4px 12px;">
								<label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
									<input type="checkbox" :checked="group.wiggle_gravity" @change="setProp('wiggle_gravity', $event.target.checked)">
									<span>Gravity</span>
								</label>
							</div>
							${slider('wiggle_air_drag', 'Air Drag', 0, 1, 0.01)}
							${slider('wiggle_turbulence', 'Turbulence', 0, 10, 0.1)}
							${slider('wiggle_turbulence_speed', 'Turb Speed', 0.1, 20, 0.1)}
						`)}

						${section('advanced', 'Advanced', `
							<div class="dialog_bar" style="padding: 4px 12px;">
								<label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
									<input type="checkbox" :checked="group.wiggle_chain" @change="setProp('wiggle_chain', $event.target.checked)">
									<span>Chain (inherit parent wiggle)</span>
								</label>
							</div>
						`)}
					</template>
				</div>
			</div>
		`,

		data() {
			return {
				group: null,
				show_wiggle: false,
				preset: 'custom',
				sections: {
					spring: true,
					rotation: false,
					limits: false,
					environment: false,
					advanced: false,
				},
			};
		},

		methods: {
			// Called whenever selection changes
			updateGroup() {
				this.group = Group.first_selected || null;
				this.show_wiggle = Format.wiggle_bones === true && !!this.group;
				if (this.group) {
					this.preset = WiggleBones.detectPreset(this.group);
				}
			},

			// Toggle wiggle bone on/off
			toggleWiggle() {
				if (!this.group) return;
				Undo.initEdit({ groups: [this.group] });
				this.group.wiggle_bone = !this.group.wiggle_bone;
				if (this.group.wiggle_bone) {
					WiggleBones.getOrCreate(this.group);
				} else {
					WiggleBones.remove(this.group);
				}
				Undo.finishEdit('Toggle wiggle bone');
				Animator.preview();
			},

			// Set any property (handles both numbers and booleans)
			setProp(prop, value) {
				if (!this.group) return;
				Undo.initEdit({ groups: [this.group] });
				if (typeof this.group[prop] === 'boolean') {
					this.group[prop] = !!value;
				} else if (prop === 'wiggle_blend') {
					this.group[prop] = Math.clamp(parseFloat(value), 0, 1);
				} else {
					this.group[prop] = parseFloat(value);
				}
				this.preset = WiggleBones.detectPreset(this.group);
				Undo.finishEdit('Update wiggle bone property');
				Animator.preview();
			},

			// Apply a preset by name
			applyPreset(name) {
				if (!this.group) return;
				Undo.initEdit({ groups: [this.group] });
				this.group.wiggle_bone = true;
				WiggleBones.applyPreset(this.group, name);
				this.preset = name;
				Undo.finishEdit('Apply wiggle preset');
				Animator.preview();
			},
		},

		mounted() {
			this._onSelectionChange = () => this.updateGroup();
			Blockbench.on('update_selection', this._onSelectionChange);
			this.updateGroup();
		},

		beforeDestroy() {
			Blockbench.removeListener('update_selection', this._onSelectionChange);
		},
	};
}
