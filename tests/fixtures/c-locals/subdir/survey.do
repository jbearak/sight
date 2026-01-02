// @lsp-done-by: "../loop.do"
* survey.do - calls bh_merge and uses the c_local macros it creates

local bh_file "birth_history.dta"
local wm_file "women.dta"

* Call bh_merge - this creates bh_merge_bh_vars_final and bh_merge_bh_vars_renamed
bh_merge `bh_file' `wm_file'

* Use the c_local macros created by bh_merge
display "Final BH vars: `bh_merge_bh_vars_final'"
display "Renamed vars: `bh_merge_bh_vars_renamed'"
