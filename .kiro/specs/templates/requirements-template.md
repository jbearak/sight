---
Last Updated: YYYY-MM-DD
Change History:
  - YYYY-MM-DD: Initial specification creation
  - YYYY-MM-DD: [Description of change]
Dependencies:
  - dependency-spec-name: [Core|Feature|Implementation] - [Brief rationale]
  - another-dependency: [Core|Feature|Implementation] - [Brief rationale]
Status: Draft
Related Specs:
  - related-spec-1: [Relationship type] - [Description of relationship]
  - related-spec-2: [Relationship type] - [Description of relationship]
Cross-References: 0
Feature Group: [Core|Cross-File|Completion|Diagnostics|Parsing|Other]
Implementation Priority: [Tier 1|Tier 2|Tier 3]
Breaking Changes: [None|Minor|Major]
Backward Compatibility: [Full|Partial|None]
---

# [Specification Name] Requirements Document

## Introduction

[Brief description of the specification purpose and scope]

### Problem Statement

[Clear description of the problem this specification solves]

### Solution Overview

[High-level description of the proposed solution]

## Glossary

- **Term 1**: Definition
- **Term 2**: Definition
- **Term 3**: Definition

## Dependencies

### Core Dependencies

[List and explain dependencies on core specifications like stata-lsp]

#### dependency-spec-name
- **Type**: Core
- **Rationale**: [Why this dependency is required]
- **Impact**: [What happens if this dependency changes]
- **Version Requirements**: [Any specific version or state requirements]

### Feature Dependencies

[List and explain dependencies on feature-specific specifications]

#### feature-dependency-name
- **Type**: Feature
- **Rationale**: [Why this dependency is required]
- **Impact**: [What happens if this dependency changes]
- **Integration Points**: [How this spec integrates with the dependency]

### Implementation Dependencies

[List and explain technical implementation dependencies]

#### implementation-dependency-name
- **Type**: Implementation
- **Rationale**: [Why this dependency is required]
- **Technical Requirements**: [Specific technical requirements]
- **Alternative Approaches**: [Other possible implementations]

## Related Specifications

### Complementary Specifications

[Specifications that work together with this one]

#### related-spec-1
- **Relationship**: Complementary
- **Integration**: [How they work together]
- **Coordination Required**: [Any coordination needed during implementation]

### Conflicting Specifications

[Specifications that might conflict with this one]

#### potentially-conflicting-spec
- **Relationship**: Potential Conflict
- **Conflict Type**: [Technical|Functional|Design]
- **Resolution Strategy**: [How to resolve the conflict]

### Superseded Specifications

[Specifications that this one replaces or makes obsolete]

#### superseded-spec
- **Relationship**: Supersedes
- **Migration Path**: [How to migrate from old to new]
- **Deprecation Timeline**: [When old spec will be archived]

## Requirements

### Functional Requirements

#### Requirement 1: [Requirement Name]

**User Story:** As a [user type], I want [functionality] so that [benefit].

**Acceptance Criteria:**
1. GIVEN [precondition] WHEN [action] THEN [expected result]
2. GIVEN [precondition] WHEN [action] THEN [expected result]
3. GIVEN [precondition] WHEN [action] THEN [expected result]

**Dependencies:**
- [List any specific dependencies for this requirement]

**Cross-References:**
- [List any related specifications that affect this requirement]

#### Requirement 2: [Requirement Name]

**User Story:** As a [user type], I want [functionality] so that [benefit].

**Acceptance Criteria:**
1. GIVEN [precondition] WHEN [action] THEN [expected result]
2. GIVEN [precondition] WHEN [action] THEN [expected result]

**Dependencies:**
- [List any specific dependencies for this requirement]

**Cross-References:**
- [List any related specifications that affect this requirement]

### Non-Functional Requirements

#### Performance Requirements
- [Specific performance criteria]
- [Benchmarks or metrics]

#### Compatibility Requirements
- [Backward compatibility requirements]
- [Integration compatibility requirements]

#### Security Requirements
- [Any security considerations]
- [Data protection requirements]

## Constraints and Assumptions

### Technical Constraints
- [Technical limitations or constraints]
- [Platform or environment constraints]

### Business Constraints
- [Timeline constraints]
- [Resource constraints]

### Assumptions
- [Key assumptions this specification makes]
- [Dependencies on external factors]

## Success Criteria

### Implementation Success
- [ ] All functional requirements implemented
- [ ] All acceptance criteria met
- [ ] Integration tests passing
- [ ] Performance benchmarks met

### Integration Success
- [ ] All dependencies properly integrated
- [ ] No breaking changes to dependent specifications
- [ ] Cross-references validated
- [ ] Registry updated

### Quality Success
- [ ] Code review completed
- [ ] Documentation updated
- [ ] Test coverage adequate
- [ ] No regression in existing functionality

## Risk Assessment

### High Risk Items
- [Items that could cause significant problems]
- [Mitigation strategies]

### Medium Risk Items
- [Items that could cause moderate problems]
- [Mitigation strategies]

### Dependencies Risks
- [Risks related to specification dependencies]
- [What happens if dependencies change]

## Implementation Notes

### Phasing Strategy
- **Phase 1**: [Initial implementation scope]
- **Phase 2**: [Extended functionality]
- **Phase 3**: [Full feature completion]

### Integration Points
- [Key integration points with other specifications]
- [Coordination requirements]

### Testing Strategy
- [Unit testing approach]
- [Integration testing approach]
- [End-to-end testing approach]

## Future Considerations

### Extensibility
- [How this specification can be extended]
- [Planned future enhancements]

### Deprecation Path
- [How this specification might be deprecated in the future]
- [Migration considerations]

### Related Future Work
- [Specifications that might build on this one]
- [Future specifications this one enables]

---

## Template Usage Instructions

### Before Creating a New Specification:

1. **Check for Existing Specifications**
   ```bash
   grep -r "similar-functionality" .kiro/specs/
   ```

2. **Analyze Dependencies**
   ```bash
   ./scripts/analyze-dependencies.sh proposed-spec-name
   ```

3. **Validate Uniqueness**
   ```bash
   ./scripts/check-specification-uniqueness.sh proposed-spec-name
   ```

### When Filling Out This Template:

1. **Replace all placeholder text** in brackets and CAPS
2. **Fill in actual dates** for Last Updated and Change History
3. **Provide specific dependency rationales** - don't just list dependencies
4. **Use precise relationship descriptions** - explain how specs relate
5. **Write testable acceptance criteria** - use GIVEN/WHEN/THEN format
6. **Include cross-reference analysis** - show how this fits with existing specs

### After Creating the Specification:

1. **Update the Registry**
   ```bash
   ./scripts/update-registry.sh new-spec-name
   ```

2. **Validate Relationships**
   ```bash
   ./scripts/validate-spec-relationships.sh new-spec-name
   ```

3. **Check for Circular Dependencies**
   ```bash
   ./scripts/detect-circular-deps.sh
   ```

### Relationship Tracking Fields Explained:

- **Dependencies**: Specifications required for this one to work
- **Related Specs**: Specifications that interact with this one
- **Cross-References**: Count of mentions in other specifications
- **Feature Group**: Organizational category for the specification
- **Implementation Priority**: Implementation order based on dependencies
- **Breaking Changes**: Impact level on existing functionality
- **Backward Compatibility**: Compatibility with previous versions