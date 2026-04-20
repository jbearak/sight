* Analysis called from orchestrator

* Use globals defined in parent
local input_file "$data_path/survey.dta"

* Call program defined in parent
clean_survey_data

* Use variables created in parent
tab analysis_sample
