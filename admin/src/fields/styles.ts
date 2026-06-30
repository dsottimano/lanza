// Shared control styling for the form-field inputs (text / number / datetime /
// select / image / list / relation). Single source of truth so the look can't
// drift between the field components. `placeholder:` is harmless on controls
// that have no placeholder.
export const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 transition placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-4 focus:ring-zinc-900/5";
