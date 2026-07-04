// Shared control styling for the form-field inputs (text / number / datetime /
// select / image / list / relation). Single source of truth so the look can't
// drift between the field components. `placeholder:` is harmless on controls
// that have no placeholder.
// `.input` is the shared Paper control surface, defined once in styles.css.
export const inputCls = "input";
