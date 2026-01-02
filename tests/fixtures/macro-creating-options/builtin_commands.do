// Test file for macro-creating options on built-in allowlist commands
// Only levelsof and glevelsof are in the allowlist

// levelsof with local() option
sysuse auto, clear
levelsof foreign, local(foreign_levels)
display "Foreign levels: `foreign_levels'"

// levelsof with global() option
levelsof rep78, global(rep_levels)
display "Rep78 levels: $rep_levels"

// glevelsof with local() option
glevelsof make, local(make_levels)
display "Make levels: `make_levels'"

// glevelsof with global() option
glevelsof price, global(price_levels)
display "Price levels: $price_levels"
