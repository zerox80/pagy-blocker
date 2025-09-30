import { describe, test, expect } from '@jest/globals';
import { parseRule } from '../core/ruleParser.js';

describe('Rule Parser', () => {
  describe('parseRule', () => {
    // Test 1: Comments and empty lines should be ignored
    test('should return null for comments and empty lines', () => {
      expect(parseRule('! This is a comment')).toBeNull();
      expect(parseRule('[Adblock Plus 2.0]')).toBeNull();
      expect(parseRule('')).toBeNull();
      expect(parseRule('   ')).toBeNull();
    });

    // Test 2: Cosmetic filters should be ignored
    test('should return null for cosmetic filters', () => {
      expect(parseRule('example.com##.ad')).toBeNull();
      expect(parseRule('example.com#@#.ad')).toBeNull();
      expect(parseRule('example.com#?#.ad')).toBeNull();
    });

    // Test 3: Simple blocking rule
    test('should parse a simple blocking rule', () => {
      const result = parseRule('||example.com^');
      expect(result).toEqual({
        rule: '||example.com^',
        type: 'network',
        pattern: '||example.com^',
        options: null,
        isException: false,
        patternType: 'network',
        isValid: true,
      });
    });

    // Test 4: Exception rule
    test('should parse an exception rule', () => {
      const result = parseRule('@@||example.com/ad$script');
      expect(result).toEqual({
        rule: '@@||example.com/ad$script',
        type: 'network',
        pattern: '||example.com/ad',
        options: [{ type: 'filter', value: 'script', negated: false }],
        isException: true,
        patternType: 'network',
        isValid: true,
      });
    });

    // Test 5: Rule with multiple options
    test('should parse a rule with multiple options', () => {
      const result = parseRule('/banner/*/img^$script,image,~third-party');
      expect(result).toEqual({
        rule: '/banner/*/img^$script,image,~third-party',
        type: 'network',
        pattern: '/banner/*/img^',
        options: [
          { type: 'filter', value: 'script', negated: false },
          { type: 'filter', value: 'image', negated: false },
          { type: 'filter', value: 'third-party', negated: true },
        ],
        isException: false,
        patternType: 'network',
        isValid: true,
      });
    });

    // Test 6: Rule with domain options
    test('should parse a rule with domain options', () => {
      const result = parseRule('||ads.example.com^$domain=example.com|~example.net');
      expect(result).toEqual({
        rule: '||ads.example.com^$domain=example.com|~example.net',
        type: 'network',
        pattern: '||ads.example.com^',
        options: [
          {
            type: 'domain',
            value: [
              { name: 'example.com', negated: false },
              { name: 'example.net', negated: true },
            ],
            negated: false,
          },
        ],
        isException: false,
        patternType: 'network',
        isValid: true,
      });
    });

    // Test 7: Invalid rule (contains dangerous pattern)
    test('should return null for a rule with dangerous patterns', () => {
      expect(parseRule('||evil.com/script<script>')).toBeNull();
    });

    // Test 8: Invalid rule (invalid option)
    test('should return null for a rule with an invalid option', () => {
        expect(parseRule('||example.com^$invalidoption')).toBeNull();
    });

    // Test 9: Rule with complex pattern
    test('should parse a rule with a complex ABP-style pattern', () => {
        const complexRule = '^ad.doubleclick.net/*/adclick^';
        const result = parseRule(complexRule);
        expect(result).toEqual({
            rule: complexRule,
            type: 'network',
            pattern: complexRule,
            options: null,
            isException: false,
            patternType: 'network',
            isValid: true,
        });
    });

    // Test 10: Exception rule with domain options
    test('should parse an exception rule with domain options', () => {
        const rule = '@@||adservice.google.com^$domain=google.com';
        const result = parseRule(rule);
        expect(result).toEqual({
            rule: rule,
            type: 'network',
            pattern: '||adservice.google.com^',
            options: [
                {
                    type: 'domain',
                    value: [{ name: 'google.com', negated: false }],
                    negated: false,
                },
            ],
            isException: true,
            patternType: 'network',
            isValid: true,
        });
    });

    // Test 11: Rule with complex domain options
    test('should parse a rule with complex domain options including multiple negations', () => {
        const rule = '||example.com^$domain=site.com|~sub.site.com|another.com|~another.sub.com';
        const result = parseRule(rule);
        expect(result).toEqual({
            rule: rule,
            type: 'network',
            pattern: '||example.com^',
            options: [
                {
                    type: 'domain',
                    value: [
                        { name: 'site.com', negated: false },
                        { name: 'sub.site.com', negated: true },
                        { name: 'another.com', negated: false },
                        { name: 'another.sub.com', negated: true },
                    ],
                    negated: false,
                },
            ],
            isException: false,
            patternType: 'network',
            isValid: true,
        });
    });

    // Test 12: Invalid rule (negated domain option)
    test('should return null for a rule with a negated domain option', () => {
      expect(parseRule('||example.com^$~domain=example.net')).toBeNull();
    });
  });
});
