# Side Panel and Modal Editing

## Decision

Keep the side panel and edit modals as separate presentation surfaces. Share
domain mutations and small field components, not the complete form markup or
form state.

## Existing Roles

### Graph side panel

- Persistent contextual inspector for the current graph selection.
- Navigates between aims and connections.
- Shows computed value, cost, progress, parents, and children.
- Offers three quick aim edits: intrinsic value, cost, and loop weight.
- Persists each changed metric immediately.
- Offers quick connection weight, explanation, and removal actions.

### Aim edit modal

- Comprehensive aim editor.
- Stages fields locally and persists only on Save.
- Supports dirty-state cancellation, archive constraints, parent and phase
  relationships, linked repositories, tags, reflection, status, and color.
- Supports staged multi-aim overrides.

### Connection details modal

- Transactional connection editor.
- Explains contribution shares relative to sibling contributors and loop
  weight.
- Saves contribution and explanation together.

## Why The Complete Form Should Not Be Shared

The primary difference is behavioral rather than geometric:

- Side-panel changes are narrow and immediate.
- Modal changes are broad, staged, cancellable, and sometimes destructive.
- The panel is also an inspector and graph-navigation surface.
- The modal owns keyboard focus cycling and nested pickers.

A shared form would need enough mode flags to recreate two components inside
one component, increasing coupling and making Save/Cancel guarantees easier to
break.

## Refactoring Boundary

Extract only:

1. A typed aim-metrics mutation action in the data store. The side panel
   currently calls `trpc.aim.update` directly and manually performs optimistic
   updates; it should use the same store mutation path as the modal.
2. A typed connection mutation action for weight, explanation, and removal.
   Both connection surfaces should call it.
3. Small reusable presentational controls where duplication is real, such as a
   value/cost/loop metric editor. Persistence remains owned by each surface.

Do not extract a universal `AimForm` or switch the panel between implicit
auto-save and modal staging through props.

## Mobile

Treat the side panel as a responsive inspector drawer:

- Desktop: resizable right-side panel.
- Narrow screens: full-width bottom sheet or full-width overlay with an
  explicit close affordance.
- Opening the comprehensive editor remains a separate command.

This preserves graph inspection on mobile without pretending that the drawer
is the edit modal.

## Next Implementation

Move the side panel's direct aim update into `dataStore.updateAim`, preserving
its immediate-save behavior. Then extract connection mutations behind one
store API before changing any markup.
