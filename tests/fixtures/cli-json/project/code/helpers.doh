program define summarize_by, rclass
    args var group
    syntax varlist [if] [in] [, Detail]
    quietly summarize `var' if `group' == 1
    return scalar m = r(mean)
end
