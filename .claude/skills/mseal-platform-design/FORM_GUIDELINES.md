# Form Guidelines

## Native HTML first

Every form is a real `<form onSubmit={...}>` with a real submit
`<button>` (implicit or explicit `type="submit"`) - never a `<div>` with
an `onClick` handler pretending to be a form. This is how Login's
Enter-to-submit already works correctly (verified, no code change needed)
and how `report-form.tsx` is built - match that pattern, don't add a
custom keydown listener for Enter unless a screen has a genuine reason a
plain form submit won't cover (state it explicitly if so).

## Keyboard

- **Enter** submits (native form behavior - free, if you used a real
  `<form>`).
- **Tab** moves through fields in visual/DOM order - don't fight this with
  manual `tabIndex` unless a field is deliberately skipped.
- **Esc** closes any modal/dialog this form opens (SweetAlert2 already
  handles this for `swalConfirm`/`swalPrompt` - don't reimplement).

## Inline validation

Validate at the point of input where practical (`type="email"`,
`required`, `pattern`), plus server-side re-validation always (client
validation is UX, never the security boundary - matches
`docs/standards/SECURITY_STANDARD.md`'s existing rule for every other
input path).

## Progressive disclosure

Don't show every field at once if a screen has conditional sections
(e.g. "Dealer" unlocking "Branch") - reuse `useDealerBranchScope()`'s
existing cascading-select pattern rather than inventing a new
show/hide scheme.

## Accessible labels

Every input has a real `<label>` (or `TextField`/`SelectField`'s built-in
label prop) - never a placeholder-as-label. Required fields get the
existing asterisk convention already used in `forms/TextField.tsx`.

## Reuse before inline markup

`forms/TextField.tsx`/`SelectField.tsx` already exist but are under-used
(`report-form.tsx` still repeats input markup inline) - prefer them for
any *new* form; migrating existing forms to them is a separate, reviewed
effort (`docs/architecture/MSEAL_DESIGN_FRAMEWORK.md`'s Migration
Roadmap), not a side effect of an unrelated change.
