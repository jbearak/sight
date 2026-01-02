*/

capture program drop gegen
program define gegen, byable(onecall) rclass
    version 13.1

    local 00 `0'
    qui syntax anything [if] [in] [using] [= exp] [weight], [by(varlist)]
    local byvars `by'
    local 0 `00'

    * Parse weights
    * -------------

    local wgt = cond("`weight'" != "", "[`weight' `exp']", "")
end
