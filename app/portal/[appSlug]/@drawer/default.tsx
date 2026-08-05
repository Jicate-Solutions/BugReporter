/**
 * Nothing in the drawer slot.
 *
 * Required, not optional: without a default the slot has no match on a hard
 * navigation to any URL under this layout, and Next renders a 404 for the whole
 * page rather than an empty slot. This file is the reason a pasted link to a
 * report still opens.
 */
export default function DrawerDefault() {
  return null;
}
