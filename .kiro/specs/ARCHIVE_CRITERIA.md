# Archive vs In-Place Update Decision Criteria

## Decision Framework

```
Specification Change Required
         │
         ▼
    Is the fundamental
    purpose changing?
         │
    ┌────┴────┐
   Yes        No
    │          │
    ▼          ▼
Archive    Is this a complete
           replacement?
                │
           ┌────┴────┐
          Yes        No
           │          │
           ▼          ▼
       Archive   In-Place Update
```

**Archive when:**
- Fundamental purpose changes
- Complete replacement available  
- Strategic abandonment justified
- Implementation complete

**Update in-place when:**
- Requirement refinement only
- Dependency updates without scope change
- Implementation details modification
- Bug fixes and corrections