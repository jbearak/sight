// generate_legacy_fixtures.do — Generate legacy .dta test fixtures
// Run from: tests/fixtures/dta/
// Requires: Stata 16+
//
// Creates fixtures in v115 (saveold, version(12)), and v114
// (saveold, version(11)). Format 113 (Stata 8) is not supported
// by saveold on modern Stata, so we skip it here.

version 16.0
set more off

// ============================================================================
// 1. auto.dta — the standard Stata example dataset
// ============================================================================

sysuse auto, clear

// v115 (Stata 12 format)
saveold "auto_v115.dta", version(12) replace

// v114 (Stata 11 format)
saveold "auto_v114.dta", version(11) replace

di as txt "Created: auto_v114.dta, auto_v115.dta"

// ============================================================================
// 2. value_labels — dataset with value label tables
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

saveold "value_labels_v115.dta", version(12) replace
saveold "value_labels_v114.dta", version(11) replace

di as txt "Created: value_labels_v114.dta, value_labels_v115.dta"

// ============================================================================
// 3. empty — zero observations with variable definitions
// ============================================================================

clear
gen double price = .
gen str20 make = ""
gen int mpg = .
label variable price "Price in USD"
label variable make "Make and model"
label variable mpg "Miles per gallon"
drop if 1

saveold "empty_v115.dta", version(12) replace
saveold "empty_v114.dta", version(11) replace

di as txt "Created: empty_v114.dta, empty_v115.dta"

// ============================================================================
// 4. missing_values — extended missing values (., .a-.z)
// ============================================================================

clear
set obs 30

gen double x_double = _n
replace x_double = . if _n == 1
replace x_double = .a if _n == 2
replace x_double = .b if _n == 3
replace x_double = .c if _n == 4
replace x_double = .z if _n == 5

gen byte x_byte = _n if _n <= 100
replace x_byte = . if _n == 1
replace x_byte = .a if _n == 2
replace x_byte = .z if _n == 3

gen int x_int = _n * 100
replace x_int = . if _n == 1
replace x_int = .a if _n == 2
replace x_int = .z if _n == 3

gen long x_long = _n * 10000
replace x_long = . if _n == 1
replace x_long = .a if _n == 2
replace x_long = .z if _n == 3

gen float x_float = _n * 1.5
replace x_float = . if _n == 1
replace x_float = .a if _n == 2
replace x_float = .z if _n == 3

label variable x_double "Double with missing values"
label variable x_byte "Byte with missing values"
label variable x_int "Int with missing values"
label variable x_long "Long with missing values"
label variable x_float "Float with missing values"

saveold "missing_values_v115.dta", version(12) replace
saveold "missing_values_v114.dta", version(11) replace

di as txt "Created: missing_values_v114.dta, missing_values_v115.dta"

// ============================================================================
// 5. all_types — one variable of each storage type (no strL in legacy)
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

label variable v_byte "Byte variable"
label variable v_int "Int variable"
label variable v_long "Long variable"
label variable v_float "Float variable"
label variable v_double "Double variable"
label variable v_str5 "Short string (str5)"
label variable v_str20 "Medium string (str20)"
label data "All Stata storage types (legacy)"

saveold "all_types_v115.dta", version(12) replace
saveold "all_types_v114.dta", version(11) replace

di as txt "Created: all_types_v114.dta, all_types_v115.dta"

// ============================================================================
// 6. wide — many variables (120)
// ============================================================================

clear
set obs 20
set seed 12345
forvalues i = 1/120 {
    gen var`i' = runiform()
}

saveold "wide_v115.dta", version(12) replace
saveold "wide_v114.dta", version(11) replace

di as txt "Created: wide_v114.dta, wide_v115.dta"

// ============================================================================
// Summary
// ============================================================================

di as txt "{hline 60}"
di as txt "All legacy fixtures generated successfully."
di as txt "v114 files: auto_v114, value_labels_v114, empty_v114,"
di as txt "            missing_values_v114, all_types_v114, wide_v114"
di as txt "v115 files: auto_v115, value_labels_v115, empty_v115,"
di as txt "            missing_values_v115, all_types_v115, wide_v115"
di as txt "{hline 60}"
