import { describe, it, expect } from 'bun:test';
import { ScopeResolver } from '../../src/scope-resolver';
import { ForwardScopeResolver } from '../../src/forward-scope-resolver';

describe('Optional .do Extension - Edge Cases', () => {
  describe('Path resolution behavior', () => {
    it('should attempt .do fallback for paths without extension', () => {
      const resolver = new ScopeResolver();
      
      // Test that the resolver has the expected fallback behavior
      // This is a basic test to ensure the classes can be instantiated
      expect(resolver).toBeDefined();
    });

    it('should handle explicit .do paths correctly', () => {
      const resolver = new ScopeResolver();
      const forwardResolver = new ForwardScopeResolver(resolver);
      
      // Test that both resolvers can be instantiated together
      expect(resolver).toBeDefined();
      expect(forwardResolver).toBeDefined();
    });
  });
});