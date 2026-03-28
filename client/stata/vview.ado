*! vview.ado — Open dataset in Sight Data Browser
*! Version 0.1.0

program define vview
    version 16.0
    syntax [varlist] [if] [in] [, Rows(integer 0) Name(string) Replace]

    // Resolve output directory
    local browseroot "~/.sight"
    local browsedir "~/.sight/browse"
    cap mkdir "`browseroot'"
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

    local source = c(filename)
    local cwd = c(pwd)
    local timestamp = c(current_date) + " " + c(current_time)
    local if_condition `"`if'"'
    local in_condition `"`in'"'
    local source_obs_n = c(N)
    local source_var_k = c(k)

    // Save subsetted data
    preserve

    // Apply if/in qualifiers
    if `"`if'`in'"' != "" {
        qui keep `if' `in'
    }

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

    // Escape backslashes and quotes for JSON.
    mata: st_local("json_dtapath", subinstr(subinstr(st_local("dtapath"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))
    mata: st_local("json_name", subinstr(subinstr(st_local("name"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))
    mata: st_local("json_source", subinstr(subinstr(st_local("source"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))
    mata: st_local("json_timestamp", subinstr(subinstr(st_local("timestamp"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))
    mata: st_local("json_if", subinstr(subinstr(st_local("if_condition"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))
    mata: st_local("json_in", subinstr(subinstr(st_local("in_condition"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))
    mata: st_local("json_cwd", subinstr(subinstr(st_local("cwd"), char(92), char(92) + char(92), .), char(34), char(92) + char(34), .))

    // Write JSON sidecar with Mata to avoid fragile Stata quote syntax.
    local replace_json = cond("`replace'" != "", "true", "false")
    local subsetted_json = cond(`obs_n' != `source_obs_n' | `var_k' != `source_var_k', "true", "false")
    mata {
        my_vview_varlist = strtrim(st_local("varlist"))
        my_vview_json_varlist = "["
        if (my_vview_varlist != "" & my_vview_varlist != "_all") {
            my_vview_vars = tokens(my_vview_varlist)
            for (my_vview_i = 1; my_vview_i <= cols(my_vview_vars); my_vview_i++) {
                my_vview_var = subinstr(
                    subinstr(
                        my_vview_vars[my_vview_i],
                        char(92),
                        char(92) + char(92),
                        .
                    ),
                    char(34),
                    char(92) + char(34),
                    .
                )
                if (my_vview_i > 1) {
                    my_vview_json_varlist = my_vview_json_varlist + ","
                }
                my_vview_json_varlist = my_vview_json_varlist + char(34) + my_vview_var + char(34)
            }
        }
        my_vview_json_varlist = my_vview_json_varlist + "]"
        st_local("json_varlist", my_vview_json_varlist)

        my_vview_fh = fopen(st_local("jsonpath"), "w")
        my_vview_q = char(34)
        fput(my_vview_fh, "{")
        fput(my_vview_fh, "  " + my_vview_q + "version" + my_vview_q + ": 1,")
        fput(my_vview_fh, "  " + my_vview_q + "uuid" + my_vview_q + ": " + my_vview_q + st_local("uuid") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "timestamp" + my_vview_q + ": " + my_vview_q + st_local("json_timestamp") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "source" + my_vview_q + ": " + my_vview_q + st_local("json_source") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "cwd" + my_vview_q + ": " + my_vview_q + st_local("json_cwd") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "name" + my_vview_q + ": " + my_vview_q + st_local("json_name") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "dtapath" + my_vview_q + ": " + my_vview_q + st_local("json_dtapath") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "varlist" + my_vview_q + ": " + st_local("json_varlist") + ",")
        fput(my_vview_fh, "  " + my_vview_q + "if" + my_vview_q + ": " + my_vview_q + st_local("json_if") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "in" + my_vview_q + ": " + my_vview_q + st_local("json_in") + my_vview_q + ",")
        fput(my_vview_fh, "  " + my_vview_q + "N" + my_vview_q + ": " + st_local("obs_n") + ",")
        fput(my_vview_fh, "  " + my_vview_q + "k" + my_vview_q + ": " + st_local("var_k") + ",")
        fput(my_vview_fh, "  " + my_vview_q + "replace" + my_vview_q + ": " + st_local("replace_json") + ",")
        fput(my_vview_fh, "  " + my_vview_q + "subsetted" + my_vview_q + ": " + st_local("subsetted_json"))
        fput(my_vview_fh, "}")
        fclose(my_vview_fh)
    }

    // Signal the extension
    tempname fh
    cap erase "`signalpath'"
    file open `fh' using "`signalpath'", write text
    file write `fh' "`uuid'"
    file close `fh'

    di as txt "Opened in Sight Data Browser" as res " (`obs_n' obs, `var_k' vars)"
end
