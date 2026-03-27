// generate_fixtures.do — Generate .dta test fixtures for the Sight Data Browser parser
// Run from: tests/fixtures/dta/
// Requires: Stata 16+
//
// Creates fixtures in v117 (saveold, version(13)), v118 (save on Stata 14-15,
// or saveold version(14) on 16+), and v119 (save on Stata 15+).

version 16.0
set more off

// ============================================================================
// 1. auto.dta — the standard Stata example dataset
//    We save it in all three formats to test cross-version parsing.
// ============================================================================

sysuse auto, clear

// v118 (Stata 14 format)
saveold "auto_v118.dta", version(14) replace

// v117 (Stata 13 format)
saveold "auto_v117.dta", version(13) replace

// v119 (current Stata format — only differs from v118 when K > 32,767 or
//        N > 2,147,483,647, but the header tag says "119")
save "auto_v119.dta", replace

di as txt "Created: auto_v117.dta, auto_v118.dta, auto_v119.dta"

// ============================================================================
// 2. strL test — dataset with long string variables (strL)
//    strL is a variable-length string type stored in the GSO block.
//    Tests GSO index building and strL pointer resolution.
// ============================================================================

clear
set obs 5
gen strL long_text = "This is observation " + string(_n)
replace long_text = long_text + ". Extra padding to make this a longer string value." if _n == 3
replace long_text = "" if _n == 4
gen id = _n
gen str10 short_text = "short" + string(_n)
label variable long_text "Long text variable"
label variable id "Observation ID"
label variable short_text "Short text variable"

save "strl_test.dta", replace
saveold "strl_test_v118.dta", version(14) replace

di as txt "Created: strl_test.dta, strl_test_v118.dta"

// ============================================================================
// 3. value_labels — dataset with value label tables
//    Tests value label table parsing and variable-to-label association.
// ============================================================================

clear
set obs 10
gen byte foreign = mod(_n, 2)
gen byte rep78 = mod(_n, 5) + 1
gen byte region = ceil(_n / 3)
replace region = min(region, 4)

label define foreign_lbl 0 "Domestic" 1 "Foreign"
label define rep_lbl 1 "Poor" 2 "Fair" 3 "Average" 4 "Good" 5 "Excellent"
label define region_lbl 1 "Northeast" 2 "Midwest" 3 "South" 4 "West"

label values foreign foreign_lbl
label values rep78 rep_lbl
label values region region_lbl

label variable foreign "Car origin"
label variable rep78 "Repair record 1978"
label variable region "Census region"

label data "Value labels test dataset"

save "value_labels.dta", replace
saveold "value_labels_v118.dta", version(14) replace
saveold "value_labels_v117.dta", version(13) replace

di as txt "Created: value_labels.dta, value_labels_v118.dta, value_labels_v117.dta"

// ============================================================================
// 4. empty — zero observations with variable definitions
//    Tests that the parser handles N=0 gracefully.
// ============================================================================

clear
gen double price = .
gen str20 make = ""
gen int mpg = .
label variable price "Price in USD"
label variable make "Make and model"
label variable mpg "Miles per gallon"
drop if 1

save "empty.dta", replace
saveold "empty_v118.dta", version(14) replace

di as txt "Created: empty.dta, empty_v118.dta"

// ============================================================================
// 5. wide — many variables (120)
//    Tests parser performance and correctness with high K.
// ============================================================================

clear
set obs 20
set seed 12345
forvalues i = 1/120 {
    gen var`i' = runiform()
}

save "wide.dta", replace
saveold "wide_v118.dta", version(14) replace

di as txt "Created: wide.dta, wide_v118.dta"

// ============================================================================
// 6. missing_values — extended missing values (., .a–.z)
//    Tests detection and classification of Stata's 27 missing value types
//    across all numeric storage types (byte, int, long, float, double).
// ============================================================================

clear
set obs 30

// double column with all missing types
gen double x_double = _n
replace x_double = . if _n == 1
replace x_double = .a if _n == 2
replace x_double = .b if _n == 3
replace x_double = .c if _n == 4
replace x_double = .z if _n == 5

// byte column with missing values
gen byte x_byte = _n if _n <= 100
replace x_byte = . if _n == 1
replace x_byte = .a if _n == 2
replace x_byte = .z if _n == 3

// int column with missing values
gen int x_int = _n * 100
replace x_int = . if _n == 1
replace x_int = .a if _n == 2
replace x_int = .z if _n == 3

// long column with missing values
gen long x_long = _n * 10000
replace x_long = . if _n == 1
replace x_long = .a if _n == 2
replace x_long = .z if _n == 3

// float column with missing values
gen float x_float = _n * 1.5
replace x_float = . if _n == 1
replace x_float = .a if _n == 2
replace x_float = .z if _n == 3

label variable x_double "Double with missing values"
label variable x_byte "Byte with missing values"
label variable x_int "Int with missing values"
label variable x_long "Long with missing values"
label variable x_float "Float with missing values"

save "missing_values.dta", replace
saveold "missing_values_v118.dta", version(14) replace

di as txt "Created: missing_values.dta, missing_values_v118.dta"

// ============================================================================
// 7. all_types — one variable of each storage type
//    Useful for testing type code parsing and byte width computation.
// ============================================================================

clear
set obs 5
gen byte v_byte = _n
gen int v_int = _n * 100
gen long v_long = _n * 100000
gen float v_float = _n * 1.1
gen double v_double = _n * 1.111111111
gen str5 v_str5 = "s" + string(_n)
gen str20 v_str20 = "longer_string_" + string(_n)
gen strL v_strL = "This is a strL value for obs " + string(_n)

label variable v_byte "Byte variable"
label variable v_int "Int variable"
label variable v_long "Long variable"
label variable v_float "Float variable"
label variable v_double "Double variable"
label variable v_str5 "Short string (str5)"
label variable v_str20 "Medium string (str20)"
label variable v_strL "Long string (strL)"
label data "All Stata storage types"

save "all_types.dta", replace
saveold "all_types_v118.dta", version(14) replace
saveold "all_types_v117.dta", version(13) replace

di as txt "Created: all_types.dta, all_types_v118.dta, all_types_v117.dta"

// ============================================================================
// Summary
// ============================================================================

di _n as txt "{hline 60}"
di as txt "All fixtures generated successfully."
di as txt "v117 files: auto_v117, value_labels_v117, all_types_v117"
di as txt "v118 files: auto_v118, strl_test_v118, value_labels_v118,"
di as txt "            empty_v118, wide_v118, missing_values_v118,"
di as txt "            all_types_v118"
di as txt "v119 files: auto_v119, strl_test, value_labels, empty,"
di as txt "            wide, missing_values, all_types"
di as txt "{hline 60}"
