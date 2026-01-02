// @lsp-included-by: "survey.do"
* wm_vars.do - Women's variables
* Inherits working directory through survey.do from loop.do

local wm_var_1 = 1
local wm_var_2 = 2

* These paths should resolve relative to inherited working directory
do "subdir/wm_vars/var1.do"
