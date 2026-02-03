* Main analysis file
* Demonstrates cross-file navigation

clear all

* Define global configuration
global data_path "data"
global output_path "output"

* Define programs used across project
program define clean_survey_data
    * Remove outliers
    drop if age < 0 | age > 120
    drop if income < 0
end

program define calculate_weights
    * Survey weight calculation
    gen weight = pop_weight * design_weight
end

* Run sub-analyses
do "demo_subprocess.do"
do "demo_tables.do"

* Create final dataset
gen analysis_sample = 1
label variable analysis_sample "Included in main analysis"