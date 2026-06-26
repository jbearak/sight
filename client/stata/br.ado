*! br.ado — CLI alias for vview (Sight Data Browser)
*! Version 0.1.0
*!
*! `br` is a standard Stata abbreviation of `browse`. In the Stata GUI, the
*! built-in `browse` command (and its abbreviations) shadows this ado, so the
*! native Data Editor is unaffected. In console Stata, `browse` is
*! unrecognized, so this ado is found on the ado-path and forwards to vview.
*! The c(console) guard makes the console-only intent explicit and ensures
*! that, should the GUI ever reach this ado, it errors clearly rather than
*! silently replacing native browse.

program define br
    version 16.0
    if (`"`c(console)'"' != "console") {
        di as err "br: the Sight alias runs only in console Stata; " ///
            "use the built-in Data Editor in the GUI"
        exit 199
    }
    vview `0'
end
