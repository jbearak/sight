*! browse.ado — CLI alias for vview (Sight Data Browser)
*! Version 0.1.0
*!
*! In the Stata GUI, the built-in `browse` command shadows this ado, so the
*! native Data Editor is unaffected. In console Stata, `browse` is
*! unrecognized, so this ado is found on the ado-path and forwards to vview.
*! The c(console) guard makes the console-only intent explicit and ensures
*! that, should the GUI ever reach this ado, it errors clearly rather than
*! silently replacing native browse.

program define browse
    version 16.0
    if (`"`c(console)'"' != "console") {
        di as err "browse: the Sight alias runs only in console Stata; " ///
            "use the built-in Data Editor in the GUI"
        exit 199
    }
    vview `0'
end
