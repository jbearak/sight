# Requirements Document

## Introduction

This specification addresses GitHub issue #61: the LSP incorrectly flags Stata system-defined global macros as undefined. Stata has a set of system-defined global macros that are automatically set by Stata at runtime. These legacy macros (replaced by `c()` class results but still widely used) should be recognized by the analyzer and not reported as undefined.

## Glossary

- **Analyzer**: The semantic analysis component (`src/analyzer/index.ts`) that builds symbol tables and detects undefined macro references
- **System_Global_Macro**: A global macro automatically defined by Stata at runtime (e.g., `$S_DATE`, `$S_TIME`)
- **is_macro_defined**: The function in the analyzer that checks if a macro is defined before reporting undefined warnings

## Requirements

### Requirement 1: Recognize System-Defined Global Macros

**User Story:** As a Stata developer, I want the LSP to recognize Stata's system-defined global macros, so that I don't receive false positive "undefined global macro" warnings.

#### Acceptance Criteria

1. THE Analyzer SHALL recognize the following system-defined global macros as always defined:
   - `S_DATE` - Current date
   - `S_TIME` - Current time
   - `S_FN` - Current filename
   - `S_FNDATE` - Date/time when current file was last saved
   - `S_ADO` - ado-path
   - `S_FLAVOR` - Stata flavor (Small, IC, SE, MP)
   - `S_OS` - Operating system
   - `S_MACH` - Machine type
   - `S_OSDTL` - OS details
   - `S_LEVEL` - Confidence level
   - `S_StataSE` - Stata SE edition indicator
   - `S_StataMP` - Stata MP edition indicator
   - `S_StataIC` - Stata IC edition indicator
   - `S_CONSOLE` - Console mode indicator
   - `S_MODE` - Stata mode

2. WHEN a reference to a system-defined global macro is encountered, THE Analyzer SHALL NOT report an undefined global macro warning

3. THE Analyzer SHALL perform case-sensitive matching for system global macro names (e.g., `$S_DATE` is valid, `$s_date` is not)

### Requirement 2: Maintain Existing Behavior for Non-System Globals

**User Story:** As a Stata developer, I want the LSP to continue detecting undefined user-defined global macros, so that I can catch typos and missing definitions.

#### Acceptance Criteria

1. WHEN a reference to a non-system global macro is encountered that is not defined, THE Analyzer SHALL report an undefined global macro warning

2. THE Analyzer SHALL NOT treat user-defined macros with similar names as system macros (e.g., `$S_CUSTOM` should still be flagged if undefined)

### Requirement 3: Provide Hover Information for System Globals

**User Story:** As a Stata developer, I want to see helpful information when hovering over system global macros, so that I understand what they represent.

#### Acceptance Criteria

1. WHEN a user hovers over a system-defined global macro reference, THE Hover_Provider SHOULD display information indicating it is a system-defined macro

2. THE Hover_Provider SHOULD include a brief description of what the system macro represents

### Requirement 4: Implementation Location

**User Story:** As a maintainer, I want the system globals list to be centralized and easy to update, so that future additions are straightforward.

#### Acceptance Criteria

1. THE system global macro names SHALL be defined in a constant set within the analyzer module

2. THE constant set SHALL be exported for use by other components (hover provider, completion provider)

3. THE implementation SHALL follow the existing pattern used for positional arguments (`is_positional_argument`)
