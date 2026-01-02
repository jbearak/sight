// @lsp-done-by: "../loop.do"
* survey.do - Middle of the directive chain
* Inherits working directory from loop.do

local country_name `1'
local survey_year `2'
global dataset_name `country_name' `survey_year'

display in white "Processing dataset: `country_name' `survey_year'"

* Forward calls should resolve relative to inherited working directory
do "subdir/year_recodes"

include "subdir/wm_vars"
include "subdir/bh_vars"
