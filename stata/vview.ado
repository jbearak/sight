*! vview.ado — Open dataset in Sight Data Browser
*! Version 0.1.0

program define vview
    version 16.0
    syntax [varlist] [if] [in] [, Rows(integer 0) Name(string) Replace]

    // Resolve output directory
    local browsedir "~/.sight/browse"
    mata: st_local("browsedir", pathjoin(pathresolve("~"), ".sight", "browse"))
    cap mkdir "`browsedir'"

    // Generate request UUID
    local uuid = strtoname("_" + subinstr(c(current_date) + c(current_time), " ", "", .) ///
        + string(runiform(), "%12.0g"), 1)

    local dtapath "`browsedir'/`uuid'.dta"
    local jsonpath "`browsedir'/`uuid'.json"
    local signalpath "`browsedir'/signal_`uuid'"

    // Determine tab name
    if `"`name'"' == "" {
        if `"`c(filename)'"' != "" {
            local name = c(filename)
        }
        else {
            local name "Untitled"
        }
    }

    // Save subsetted data
    preserve

    // Apply if/in qualifiers
    marksample touse, novarlist
    qui keep if `touse'
    drop `touse'

    if "`varlist'" != "" {
        keep `varlist'
    }
    if `rows' > 0 {
        if _N > `rows' {
            keep in 1/`rows'
            di as txt "(showing first `rows' of `=_N' observations)"
        }
    }

    local obs_n = c(N)
    local var_k = c(k)

    qui save "`dtapath'", replace
    restore

    // Escape backslashes for JSON (Windows paths)
    local json_dtapath = subinstr(`"`dtapath'"', "\", "\\", .)
    local json_name = subinstr(`"`name'"', "\", "\\", .)

    // Write JSON sidecar
    tempname fh
    file open `fh' using "`jsonpath'", write replace
    file write `fh' `"{"' _n
    file write `fh' `"  "version": 1,"' _n
    file write `fh' `"  "uuid": "`uuid'","' _n
    file write `fh' `"  "name": "`json_name'","' _n
    file write `fh' `"  "dtapath": "`json_dtapath'","' _n
    file write `fh' `"  "N": `obs_n',"' _n
    file write `fh' `"  "k": `var_k',"' _n
    file write `fh' `"  "replace": `= cond("`replace'" != "", "true", "false")',"' _n
    file write `fh' `"  "subsetted": `= cond("`varlist'`if'`in'" != "", "true", "false")'"' _n
    file write `fh' `"}"' _n
    file close `fh'

    // Signal the extension
    file open `fh' using "`signalpath'", write replace
    file write `fh' "`uuid'"
    file close `fh'

    di as txt "Opened in Sight Data Browser" as res " (`obs_n' obs, `var_k' vars)"
end
