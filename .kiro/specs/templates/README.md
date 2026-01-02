# Specification Templates

This directory contains templates for creating new specifications with proper relationship tracking and dependency management.

## Available Templates

### requirements-template.md
Complete template for specification requirements documents including:
- Standardized metadata headers with relationship tracking fields
- Dependency analysis sections
- Cross-reference documentation
- Acceptance criteria formatting
- Risk assessment framework

### design-template.md
Comprehensive template for design documents including:
- Architecture integration guidelines
- Dependency integration specifications
- Component relationship mapping
- Interface specifications
- Performance and security considerations

### tasks-template.md
Detailed template for implementation task breakdowns including:
- Cross-specification task coordination
- Dependency sequencing
- Risk management procedures
- Quality assurance requirements
- Success metrics definition

## Template Usage

### Creating from Templates

1. **Copy template files**:
   ```bash
   mkdir .kiro/specs/new-spec-name
   cp .kiro/specs/templates/requirements-template.md .kiro/specs/new-spec-name/requirements.md
   cp .kiro/specs/templates/design-template.md .kiro/specs/new-spec-name/design.md
   cp .kiro/specs/templates/tasks-template.md .kiro/specs/new-spec-name/tasks.md
   ```

2. **Fill in relationship tracking fields**:
   - Replace all placeholder text in brackets and CAPS
   - Provide specific dependency rationales
   - Document all cross-references
   - Set appropriate feature group and priority

### Template Customization

Templates can be customized for specific types of specifications:

- **Core specifications**: Focus on architectural impact and system-wide dependencies
- **Feature specifications**: Emphasize user-facing functionality and integration points
- **Infrastructure specifications**: Highlight performance, scalability, and maintenance concerns

## Relationship Tracking Fields

### Required Metadata Fields

- **Last Updated**: ISO date format (YYYY-MM-DD)
- **Change History**: Chronological list of changes with dates and descriptions
- **Dependencies**: List of prerequisite specifications with rationales
- **Status**: Current lifecycle status (Draft|Active|Implemented|Archived)
- **Related Specs**: Cross-references to related specifications
- **Cross-References**: Count of mentions in other specifications
- **Feature Group**: Organizational category
- **Implementation Priority**: Implementation order (Tier 1-3)

### Optional Metadata Fields

- **Breaking Changes**: Impact level on existing functionality
- **Backward Compatibility**: Compatibility with previous versions
- **Implementation Impact**: Scope of implementation changes
- **Architecture Changes**: Level of architectural modifications

## Best Practices

### Dependency Documentation
- Always explain why each dependency is needed
- Classify dependencies as Core, Feature, or Implementation
- Document what happens if dependencies change
- Consider alternative approaches

### Cross-Reference Management
- Document all relationships between specifications
- Explain the nature of each relationship
- Keep cross-references bidirectional where appropriate
- Update cross-references when specifications change

### Change Tracking
- Update change history for every modification
- Include rationale for changes
- Reference related issues or discussions
- Maintain chronological order

### Quality Assurance
- Use testable acceptance criteria (GIVEN/WHEN/THEN format)
- Include specific success metrics
- Plan for validation and testing
- Consider rollback procedures

## Template Evolution

Templates are living documents that evolve based on:
- Lessons learned from specification creation
- Changes in project architecture
- Feedback from specification authors
- Process improvement initiatives

To suggest template improvements:
1. Document the issue or enhancement need
2. Propose specific changes
3. Test changes with a sample specification
4. Update templates and documentation

---

These templates ensure consistent, well-documented specifications that maintain proper dependency relationships and support effective project management.