# Building a Stata Language Server Protocol: Research & Implementation Guide

**Research Date:** December 20, 2024  
**Purpose:** Comprehensive guide for building a deterministic, version-aware Stata LSP

---

## Executive Summary

StataCorp provides no machine-readable command documentation API, but **SMCL (Stata Markup and Control Language) help files** bundled with every Stata installation offer a structured, parsable format for deterministic extraction. The most practical LSP architecture combines automated SMCL parsing with version-keyed metadata caches, following patterns proven by Julia's LanguageServer.jl. An existing Python LSP (stata-language-server) provides a foundation but uses manually-curated static files lacking version metadata and abbreviation support.

**Key Finding:** SMCL files are located in `[STATA_INSTALL]/ado/base/` and can be programmatically parsed to extract command syntax, options, and documentation.

---

## Table of Contents

1. [Official Documentation Sources](#official-documentation-sources)
2. [Obtaining SMCL Files](#obtaining-smcl-files)
3. [SMCL File Format & Structure](#smcl-file-format--structure)
4. [Existing Community Resources](#existing-community-resources)
5. [Recommended LSP Architecture](#recommended-lsp-architecture)
6. [Stata Syntax Challenges](#stata-syntax-challenges)
7. [Version Management Strategy](#version-management-strategy)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Official Documentation Sources

### 1. SMCL Help Files (`.sthlp`)

**Format:** Structured text markup with parsable directives  
**Location:** Bundled with Stata in `ado/base/` directory  
**Quantity:** 19,000+ pages worth of documentation across ~1,000+ commands  
**Accessibility:** Programmatically accessible via file system

SMCL files use standardized sections and directives:

```smcl
{smcl}
{title:Title}
{cmd:regress} {hline 2} Linear regression

{synoptset 20 tabbed}
{synopthdr}
{synopt:{opt noc:onstant}}suppress constant term{p_end}
{synopt:{opt vce(vcetype)}}variance estimator{p_end}
```

**Key SMCL directives for parsing:**
- `{synopt}` - Option tables with syntax and descriptions
- `{cmd:}` - Command references
- `{help command}` - Cross-references to other commands
- `{marker name}` - Anchors for internal navigation
- `{title:}` - Section headers
- `{synoptset}` - Syntax option set definitions

### 2. PDF Manuals

**Format:** Comprehensive 19,000+ page reference  
**Location:** https://www.stata.com/manuals/  
**Accessibility:** Free download, but not machine-readable  
**Use Case:** Manual reference, not suitable for automated parsing

### 3. Runtime APIs (Supplementary)

For dynamic introspection:

| API | Platform | Key Capability |
|-----|----------|----------------|
| **Python SFI** | All | `SFIToolkit.stata()` executes commands, accesses macros/scalars |
| **PyStata** | Stata 17+ | `stata.run()` from Jupyter/standalone Python |
| **Windows Automation** | Windows | COM interface for full Stata control |
| **Java API** | Stata 16+ | Embedded Java code execution |

**Use Case:** Runtime augmentation for commands where static parsing fails

---

## Obtaining SMCL Files

### Method 1: From Installed Stata (Recommended)

SMCL files are bundled with every Stata installation in the **BASE directory**:

#### Finding the BASE Directory

Run in Stata:
```stata
sysdir
```

Output example:
```
STATA:    C:\Program Files\Stata19\
BASE:     C:\Program Files\Stata19\ado\base\
SITE:     C:\Program Files\Stata19\ado\site\
PLUS:     c:\ado\plus\
PERSONAL: c:\ado\personal\
```

#### Default Locations by Platform

**Windows:**
```
C:\Program Files\Stata19\ado\base\
C:\Program Files\Stata18\ado\base\
C:\Program Files\Stata17\ado\base\
```

**macOS:**
```
/Applications/Stata/ado/base/
/Applications/StataMP/ado/base/
/Applications/StataSE/ado/base/
```

**Linux:**
```
/usr/local/stata19/ado/base/
/usr/local/stata18/ado/base/
```

### Method 2: Programmatic Access from Stata

```stata
// View raw SMCL file
type "C:\Program Files\Stata19\ado\base\r\regress.sthlp", asis

// Search and display
viewsource regress.sthlp

// Find file path
findfile regress.sthlp

// List all help files
local base "`c(sysdir_base)'"
dir "`base'*/*.sthlp"
```

### Method 3: Without Stata Installation

**Option A: Extract from colleague/institution**
- Request zipped `ado/base/` directory from Stata user
- Files are plain text, portable across systems
- Note: Respect StataCorp's license (academic/non-commercial use)

**Option B: Institutional access**
- Universities often have network Stata installations
- BASE directories may be accessible on shared drives

**Option C: Parse PDFs** (less ideal)
- Free manuals at https://www.stata.com/manuals/
- Requires PDF parsing (more error-prone)

### Directory Structure

```
ado/base/
├── a/
│   ├── anova.ado         # Command implementation
│   ├── anova.sthlp       # SMCL documentation (target)
│   ├── append.ado
│   ├── append.sthlp
│   └── ...
├── b/
│   ├── bootstrap.ado
│   ├── bootstrap.sthlp
│   └── ...
├── c/
├── ... (through z)
├── w/
│   ├── whatsnew18.sthlp  # Version history (important!)
│   ├── whatsnew17to18.sthlp
│   └── ...
└── _/
    └── _all.sthlp        # Special entries
```

**Key observations:**
- Commands organized alphabetically in subdirectories
- Each command has `.ado` (implementation) and `.sthlp` (documentation)
- `whatsnew*.sthlp` files contain version change logs

---

## SMCL File Format & Structure

### Core Directives for LSP Parsing

#### 1. Syntax Definitions

```smcl
{synoptset 20 tabbed}
{synopthdr}
{synoptline}
{synopt:{opt noc:onstant}}suppress constant term{p_end}
{synopt:{opt r:obust}}robust standard errors{p_end}
{synopt:{opt vce(vcetype)}}vcetype may be {opt r:obust}, {opt cl:uster} clustvar{p_end}
{synoptline}
```

**Parsing targets:**
- `{synoptset}` - Defines column widths
- `{synopt:...}` - Individual option entries
- `{opt abbr:eviation}` - Shows minimum abbreviation (underlined portion)
- `{p_end}` - Paragraph/entry terminator

#### 2. Command Syntax Patterns

```smcl
{title:Syntax}

{p 8 17 2}
{cmd:regress}
{depvar}
[{indepvars}]
{ifin}
{weight}
[{cmd:,} {it:options}]
```

**Parsing strategy:**
- Extract from `{title:Syntax}` section
- Identify required vs optional elements (brackets)
- Map to standard Stata syntax grammar

#### 3. Stored Results

```smcl
{synoptset 20 tabbed}
{p2col 5 20 24 2: Scalars}{p_end}
{synopt:{cmd:e(N)}}number of observations{p_end}
{synopt:{cmd:e(r2)}}R-squared{p_end}
{synopt:{cmd:e(rmse)}}root mean squared error{p_end}

{synoptset 20 tabbed}
{p2col 5 20 24 2: Matrices}{p_end}
{synopt:{cmd:e(b)}}coefficient vector{p_end}
{synopt:{cmd:e(V)}}variance-covariance matrix{p_end}
```

**LSP use case:** Provide autocompletion for `r()` and `e()` returns

#### 4. Cross-References

```smcl
{help regress}
{help regress##options:regress options}
{manhelp estimation R}
```

**LSP use case:** Build command relationship graph for "go to definition"

### whatsnew Files (Version Metadata)

Located at `ado/base/w/whatsnew*.sthlp`:

```smcl
{hline 8} {hi:update 07dec2021} {hline 8}

    1.  {help regress} now supports option {opt vce(jackknife)}.
    
    2.  New command {help dtable} creates tables of descriptive statistics.
```

**Parsing strategy:**
1. Extract date markers (`{hi:update DDMMMYYYY}`)
2. Link commands to introduction/modification dates
3. Build version-to-command mapping

---

## Existing Community Resources

### BlackHart98/stata-language-server

**Repository:** https://github.com/BlackHart98/stata-language-server  
**Fork:** https://github.com/euglevi/stata-language-server (actively maintained)  
**Language:** Python (pygls library)  
**Status:** Functional but limited

#### Architecture

**Static Resources:**
1. **`commands.json`** - Manually curated command metadata
   - Command names
   - Basic syntax patterns
   - Descriptions for autocompletion

2. **`md_syntax/` directory** - Markdown docstrings
   - One file per command (e.g., `regress.md`)
   - Extracted from StataCorp documentation
   - Formatted for hover tooltips
   - Note: "Original work copyright belongs to StataCorp LLC"

#### How It Works

```python
# Pseudocode representation
def on_hover(document, position):
    word = get_word_at_position(document, position)
    if word in commands_json:
        md_file = f"md_syntax/{word}.md"
        return load_markdown(md_file)
    return None

def on_completion(document, position):
    return [cmd for cmd in commands_json.keys()]
```

#### Limitations

1. **No abbreviation support** - Won't recognize `g` → `generate`
2. **No nested commands** - `replace` documented in `generate.sthlp` not handled
3. **No version metadata** - Can't distinguish Stata 15 vs Stata 18 features
4. **Manual curation** - `commands.json` and `md_syntax/` require hand-editing
5. **Incomplete coverage** - Only includes commands that were manually added

#### Improvements Needed

Your LSP should address these by:
- Automated SMCL extraction (not manual curation)
- Abbreviation dictionary with minimum lengths
- Version-keyed databases
- Parsing nested command documentation

### kylebarron/language-stata

**Repository:** https://github.com/kylebarron/language-stata  
**Format:** TextMate grammar (JSON)  
**Purpose:** Syntax highlighting only (not semantic)  
**Status:** Mature, but syntax-only

**Capabilities:**
- Regex patterns for tokenization
- Nested macro expansion highlighting
- Factor variable syntax (`i.var`, `c.var#c.other`)
- Time-series operators (`L.`, `D.`)
- SQL in ODBC commands
- Dynamic documents

**Use for LSP:** Extract regex patterns for tokenization, but not sufficient for semantic analysis

### Other Resources

| Resource | Format | Contains | LSP Value |
|----------|--------|----------|-----------|
| **KDE/syntax-highlighting** | Kate XML | Keyword lists by category | Keyword extraction |
| **haghish/statax** | JavaScript | Word lists for highlighters | Command enumeration |
| **worldbank/stata-linter** | Python | Style checking patterns | Code quality rules |
| **mcaceresb/highlight-sas-stata** | Pygments | Lexer definitions | Token patterns |

**Notable Gap:** No tree-sitter grammar exists for Stata (creating one would benefit ecosystem)

---

## Recommended LSP Architecture

### Hybrid Approach: Julia LanguageServer.jl Pattern

Julia's LSP uses **pre-computed, version-keyed caches with CDN distribution**:

```
stata-lsp-cache/
├── schema.json          # Shared structure definition
├── v15/
│   └── commands.json    # Stata 15 metadata
├── v16/
│   └── commands.json    # Stata 16 metadata
├── v17/
│   └── commands.json
└── v18/
    └── commands.json
```

### Cache Structure

```json
{
  "version": "18.0",
  "generated": "2024-12-20T00:00:00Z",
  "commands": {
    "regress": {
      "syntax": "regress depvar [indepvars] [if] [in] [weight] [, options]",
      "introduced_version": "1.0",
      "deprecated": false,
      "options": {
        "vce": {
          "syntax": "vce(vcetype)",
          "values": ["robust", "cluster clustvar", "bootstrap", "jackknife"],
          "introduced_version": "9.0",
          "description": "variance estimation method"
        },
        "noconstant": {
          "syntax": "noconstant",
          "introduced_version": "1.0",
          "abbreviation": "noc",
          "description": "suppress constant term"
        }
      },
      "returns": {
        "scalars": {
          "e(N)": {"type": "numeric", "description": "number of observations"},
          "e(r2)": {"type": "numeric", "description": "R-squared"},
          "e(rmse)": {"type": "numeric", "description": "root mean squared error"}
        },
        "matrices": {
          "e(b)": {"description": "coefficient vector"},
          "e(V)": {"description": "variance-covariance matrix"}
        }
      },
      "aliases": [],
      "help_file": "regress.sthlp"
    }
  },
  "abbreviations": {
    "g": "generate",
    "gen": "generate",
    "gener": "generate",
    "reg": "regress",
    "regr": "regress"
  }
}
```

### LSP Runtime Architecture

```
┌─────────────────────────────────────────────────┐
│              LSP Client (VS Code)                │
└────────────────┬────────────────────────────────┘
                 │ LSP Protocol
┌────────────────▼────────────────────────────────┐
│              Stata LSP Server                    │
├─────────────────────────────────────────────────┤
│  • Parser (SMCL → AST)                          │
│  • Version detector (reads `version` statement) │
│  • Command database (version-specific cache)    │
│  • Abbreviation expander                        │
└────────────────┬────────────────────────────────┘
                 │ Load at startup
┌────────────────▼────────────────────────────────┐
│          Version-Specific Cache                  │
│     (Generated offline from SMCL files)         │
└─────────────────────────────────────────────────┘
```

### Comparison with Other LSPs

| LSP | Version Strategy | Documentation Source | Stata Equivalent |
|-----|------------------|---------------------|------------------|
| **Julia** | Pre-computed caches keyed by package version + UUID | Package metadata | ✅ Version-keyed SMCL caches |
| **R** | Runtime introspection via `help()` | R's built-in help system | ❌ Stata lacks introspection API |
| **Python** | Static analysis + stub files (`.pyi`) | Type hints, docstrings | ⚠️ Could create "stub" files |
| **SAS** | Static snippets | Hard-coded | ❌ Not maintainable |

**Recommendation:** Follow Julia pattern with offline cache generation

---

## Stata Syntax Challenges

### Challenge 1: Macro Expansion

**Problem:** Macros expand at parse time, making syntax context-dependent

```stata
local varname "price"
regress `varname' mpg weight  // Expands to: regress price mpg weight
```

**LSP Strategy:**
- Track local/global macro definitions in symbol table
- Expand macros before parsing
- Handle nested expansion: `` `x`i'' ``

### Challenge 2: Command Abbreviations

**Problem:** Stata allows minimum unique abbreviations

| Command | Full | Min Abbrev | Examples |
|---------|------|------------|----------|
| `generate` | generate | `g` | g, ge, gen, gener, genera, generat |
| `summarize` | summarize | `su` | su, sum, summ, summa, summar, summari, summariz |
| `regress` | regress | `reg` | reg, regr, regre, regres |
| `replace` | replace | `replace` | replace (destructive, no abbrev) |

**LSP Strategy:**
- Build abbreviation trie from documentation
- Extract minimum abbreviation from `{opt abbr:eviation}` patterns
- Mark destructive commands (require full spelling)

### Challenge 3: No Formal Grammar

**Problem:** StataCorp publishes no BNF/EBNF grammar

**Standard command pattern:**
```
[by varlist:] command [varlist] [=exp] [if exp] [in range] [weight] [using filename] [, options]
```

**LSP Strategy:**
- Extract patterns from `syntax` command in ado-files
- Parse SMCL syntax diagrams
- Build grammar incrementally from examples

### Challenge 4: Syntax Evolution Across Versions

| Version | Key Addition |
|---------|--------------|
| Stata 8 | `//` and `///` comment styles |
| Stata 11 | **Factor variables** (`i.`, `c.`, `#`) |
| Stata 13 | Unicode support, 2045-byte strings |
| Stata 16 | **Frames** (multiple datasets), `frame prefix:` |
| Stata 17 | `collect` suite, `etable` command |
| Stata 18 | `dtable`, enhanced editor highlighting |

**Important:** Evolution is **additive only**. The `version` statement ensures backward compatibility:

```stata
version 15  // Parse as Stata 15, even in Stata 18
regress y x
```

**LSP Strategy:**
- Parse `version` statement in file header
- Load appropriate version-specific cache
- No breaking changes to handle

---

## Version Management Strategy

### Version Detection

```stata
// Detect from file header
version 18.0
clear all
use auto.dta

// Or from global setting
set version 17
```

**LSP Implementation:**
```python
def detect_version(document):
    # Check first 10 lines for version statement
    for line in document.lines[:10]:
        match = re.match(r'^\s*version\s+([\d.]+)', line)
        if match:
            return match.group(1)
    # Default to latest or user-configured version
    return config.default_stata_version
```

### Building Version-Specific Caches

#### Step 1: Obtain SMCL Files for Each Version

```bash
# Example directory structure
stata-smcl-sources/
├── v15/
│   └── ado/base/  # From Stata 15 installation
├── v16/
│   └── ado/base/  # From Stata 16 installation
├── v17/
│   └── ado/base/
└── v18/
    └── ado/base/
```

#### Step 2: Parse SMCL Files

```python
def parse_smcl_directory(base_dir, version):
    commands = {}
    
    # Iterate through alphabetical subdirectories
    for letter_dir in base_dir.glob('*/'):
        for sthlp_file in letter_dir.glob('*.sthlp'):
            cmd_name = sthlp_file.stem
            
            # Parse SMCL file
            cmd_data = parse_smcl_file(sthlp_file)
            
            # Add version metadata
            cmd_data['file_version'] = version
            
            commands[cmd_name] = cmd_data
    
    return commands
```

#### Step 3: Generate Version Deltas

```python
def compute_version_delta(v1_commands, v2_commands):
    """Compute what changed between versions"""
    delta = {
        'added': [],
        'modified': [],
        'removed': []
    }
    
    for cmd in v2_commands:
        if cmd not in v1_commands:
            delta['added'].append(cmd)
        elif v2_commands[cmd] != v1_commands[cmd]:
            delta['modified'].append(cmd)
    
    for cmd in v1_commands:
        if cmd not in v2_commands:
            delta['removed'].append(cmd)
    
    return delta
```

#### Step 4: Augment with whatsnew Data

```python
def parse_whatsnew_file(whatsnew_sthlp):
    """Extract version-specific changes"""
    changes = []
    current_date = None
    
    with open(whatsnew_sthlp) as f:
        for line in f:
            # Match date markers
            date_match = re.search(r'{hi:update (\d{2}\w{3}\d{4})}', line)
            if date_match:
                current_date = date_match.group(1)
            
            # Match command references
            cmd_match = re.search(r'{help ([a-z_]+)}', line)
            if cmd_match and current_date:
                changes.append({
                    'date': current_date,
                    'command': cmd_match.group(1),
                    'description': line.strip()
                })
    
    return changes
```

### Distribution Strategy

**Option 1: NPM Package**
```json
{
  "name": "stata-lsp-caches",
  "version": "1.0.0",
  "files": [
    "caches/v15/commands.json",
    "caches/v16/commands.json",
    "caches/v17/commands.json",
    "caches/v18/commands.json"
  ]
}
```

**Option 2: GitHub Releases**
- Create release per Stata version
- Attach `stata-v18-cache.tar.gz`
- LSP downloads on first run

**Option 3: Embedded in LSP**
- Bundle caches in LSP binary
- Larger download, but no network dependency

---

## Implementation Roadmap

### Phase 1: SMCL Parser (2-3 weeks)

**Goal:** Extract structured data from `.sthlp` files

**Tasks:**
1. Build SMCL tokenizer
   - Handle directives: `{cmd:}`, `{opt:}`, `{synopt}`, etc.
   - Support nested braces and escaping
   
2. Parse syntax sections
   - Extract from `{title:Syntax}` blocks
   - Identify required vs optional parameters
   - Handle multiple syntax variants
   
3. Parse option tables
   - Extract from `{synoptset}` blocks
   - Map option syntax to descriptions
   - Identify abbreviations from `{opt abbr:eviation}`
   
4. Parse stored results
   - Extract `r()` and `e()` returns
   - Categorize as scalars, matrices, macros
   
5. Build cross-reference graph
   - Parse `{help}` links
   - Track related commands

**Deliverable:** `smcl_parser.py` library

### Phase 2: Cache Generation (1-2 weeks)

**Goal:** Generate version-specific JSON caches

**Tasks:**
1. Set up version directories
   - Obtain SMCL files for Stata 15, 16, 17, 18
   - Organize in `smcl-sources/vXX/ado/base/`
   
2. Write cache generator
   - Iterate through all `.sthlp` files
   - Apply SMCL parser
   - Output structured JSON
   
3. Build abbreviation dictionary
   - Extract minimum abbreviations
   - Handle special cases (destructive commands)
   - Create bidirectional mapping
   
4. Parse version history
   - Process `whatsnew*.sthlp` files
   - Link changes to commands
   - Annotate introduction/modification dates
   
5. Validate completeness
   - Compare against official command list
   - Identify missing/malformed entries

**Deliverable:** `v15-v18` JSON cache files

### Phase 3: LSP Server Core (3-4 weeks)

**Goal:** Build functional LSP with basic features

**Tasks:**
1. Set up LSP framework
   - Choose library: pygls (Python), tower-lsp (Rust), or custom
   - Implement LSP protocol handlers
   
2. Version detection
   - Parse `version` statement from documents
   - Load appropriate cache
   
3. Implement features:
   - **Hover:** Show command documentation
   - **Completion:** Suggest commands and options
   - **Go to Definition:** Jump to variable declarations
   - **Signature Help:** Show syntax while typing
   
4. Abbreviation expansion
   - Expand `g` → `generate` in completions
   - Handle partial matches

**Deliverable:** Functional LSP server

### Phase 4: Advanced Features (2-3 weeks)

**Goal:** Tree-sitter grammar and advanced analysis

**Tasks:**
1. Create tree-sitter grammar
   - Define Stata syntax in tree-sitter DSL
   - Handle macros, comments, string literals
   - Support factor variables and time-series operators
   
2. Implement semantic analysis
   - Build symbol table for variables
   - Track macro definitions
   - Identify undefined references
   
3. Add diagnostics
   - Syntax errors
   - Undefined variables
   - Deprecated commands (version-aware)
   - Style violations

**Deliverable:** Enhanced LSP with tree-sitter

### Phase 5: Testing & Distribution (1-2 weeks)

**Goal:** Package for release

**Tasks:**
1. Comprehensive testing
   - Unit tests for SMCL parser
   - Integration tests for LSP features
   - Test against real Stata code
   
2. Documentation
   - API documentation
   - User guide
   - Configuration options
   
3. Package for distribution
   - NPM package for caches
   - LSP binary/package
   - VS Code extension

**Deliverable:** Production-ready LSP

---

## Quick Start Guide

### 1. Extract SMCL Files

```bash
# On system with Stata installed
stata
. sysdir
. exit

# Copy BASE directory
cp -r "C:\Program Files\Stata18\ado\base" ./stata-smcl-sources/v18/
```

### 2. Parse SMCL Files

```python
from smcl_parser import parse_command_file

# Parse single file
regress_data = parse_command_file('stata-smcl-sources/v18/r/regress.sthlp')

# Generate full cache
python generate_cache.py --version 18 --input ./stata-smcl-sources/v18/ --output ./caches/v18.json
```

### 3. Start LSP Server

```bash
# Python
python stata_lsp_server.py --cache-dir ./caches

# Or Rust
cargo run --release -- --cache-dir ./caches
```

### 4. Configure Editor

**VS Code (`settings.json`):**
```json
{
  "stata.lsp.cacheDirectory": "./caches",
  "stata.lsp.defaultVersion": "18",
  "stata.lsp.enableAbbreviations": true
}
```

---

## Appendix A: SMCL Directive Reference

### Common Directives

| Directive | Purpose | Example |
|-----------|---------|---------|
| `{smcl}` | File header | `{smcl}` |
| `{title:}` | Section title | `{title:Syntax}` |
| `{cmd:}` | Command text | `{cmd:regress}` |
| `{opt:}` | Option text | `{opt:noconstant}` |
| `{opt abbr:eviation}` | Abbreviatable option | `{opt noc:onstant}` |
| `{synoptset}` | Start option table | `{synoptset 20 tabbed}` |
| `{synopt:}` | Option entry | `{synopt:{opt vce(vcetype)}}` |
| `{p_end}` | End paragraph | `{p_end}` |
| `{help}` | Cross-reference | `{help regress}` |
| `{marker}` | Anchor point | `{marker options}` |

### Parsing Patterns

**Extract options:**
```regex
{synopt:\{opt\s+([^}]+)\}}(.+?)\{p_end\}
```

**Extract abbreviation:**
```regex
{opt\s+(\w+):(\w+)}
# Group 1: minimum abbreviation
# Group 2: full command
```

---

## Appendix B: Stata Version Timeline

| Version | Release Date | Key Features |
|---------|--------------|--------------|
| Stata 18 | April 2023 | `dtable`, `bayes: hetprobit`, enhanced editor |
| Stata 17 | April 2021 | Tables via `collect`, PyStata, `markdown` export |
| Stata 16 | June 2019 | Frames, lasso, Python integration, Meta-analysis |
| Stata 15 | June 2017 | Unicode, dynamic documents (`putdocx`), IRT |
| Stata 14 | April 2015 | Unicode regex, Bayesian analysis, fractional outcomes |
| Stata 13 | June 2013 | Treatment effects, multilevel SEM, long strings |
| Stata 12 | July 2011 | SEM (structural equation modeling) |
| Stata 11 | July 2009 | Factor variables, multiple imputation |

---

## Appendix C: Resources

### Official StataCorp Resources
- Manuals: https://www.stata.com/manuals/
- Support: https://www.stata.com/support/
- Updates: https://www.stata.com/support/updates/

### Community Projects
- kylebarron/language-stata: https://github.com/kylebarron/language-stata
- BlackHart98/stata-language-server: https://github.com/BlackHart98/stata-language-server
- euglevi/stata-language-server: https://github.com/euglevi/stata-language-server
- tree-sitter: https://tree-sitter.github.io/ (no Stata grammar yet)

### LSP Resources
- LSP Specification: https://microsoft.github.io/language-server-protocol/
- pygls (Python): https://github.com/openlawlibrary/pygls
- tower-lsp (Rust): https://github.com/ebkalderon/tower-lsp

---

## Conclusion

Building a production-quality Stata LSP requires:

1. **Automated SMCL parsing** (not manual curation)
2. **Version-keyed caches** for Stata 15-18+
3. **Abbreviation dictionary** with minimum lengths
4. **Tree-sitter grammar** for robust parsing
5. **Semantic analysis** for macro tracking

The SMCL files bundled with Stata provide a structured, parsable source of truth. Following Julia's LanguageServer.jl pattern with offline cache generation ensures deterministic, maintainable builds. The existing stata-language-server provides a starting point but requires significant enhancement to handle abbreviations, versions, and nested documentation.

**Estimated Timeline:** 10-14 weeks for full implementation
**Key Bottleneck:** Obtaining SMCL files for multiple Stata versions
**Biggest Impact:** Abbreviation support and version-aware features

---

**Document Version:** 1.0  
**Last Updated:** December 20, 2024
