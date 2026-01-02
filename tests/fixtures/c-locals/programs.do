* programs.do - defines bh_merge program with c_locals

capture program drop bh_merge
program define bh_merge
    args bh_file wm_file
    
    * These c_local statements create local macros in the caller's scope
    c_local bh_merge_bh_vars_final "`bh_file'"
    c_local bh_merge_bh_vars_renamed "`wm_file'"
    
    display "Merging `bh_file' with `wm_file'"
end
