
import assert from 'assert';
import { precompileFilterList } from './filter_precompiler.js';

console.log('🧪 Running Pagy Blocker Precompiler Tests');
console.log('=========================================');

const testResults = [];

function runTest(name, testFunction) {
    try {
        testFunction();
        console.log(`✅ ${name}`);
        testResults.push({ name, passed: true });
    } catch (error) {
        console.error(`❌ ${name}`);
        console.error(`   Error: ${error.message}`);
        testResults.push({ name, passed: false, error: error.message });
    }
}

// Helper function to find a rule with specific properties
function findRuleByUrlFilter(rules, urlFilter) {
    return rules.find(rule => rule.condition.urlFilter === urlFilter);
}

runTest('Should process a basic filter list', () => {
    const filterText = '||example.com^\n||test.org^';
    const result = precompileFilterList(filterText);
    assert.strictEqual(result.rules.length, 2);
    assert.strictEqual(result.stats.processedRules, 2);
    
    // Find specific rules instead of assuming order
    const exampleRule = findRuleByUrlFilter(result.rules, '||example.com^');
    assert(exampleRule, 'Should find example.com rule');
    assert.strictEqual(exampleRule.action.type, 'block');
    assert.strictEqual(exampleRule.priority, 1);
});

runTest('Should handle comments and empty lines', () => {
    const filterText = '! Title: Test List\n# Comment\n\n||example.com^';
    const result = precompileFilterList(filterText);
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.stats.processedRules, 1);
    assert.strictEqual(result.stats.totalLines, 4); // 4 total lines, only 1 processed
    
    const rule = findRuleByUrlFilter(result.rules, '||example.com^');
    assert(rule, 'Should find example.com rule');
});

runTest('Should deduplicate rules', () => {
    const filterText = '||example.com^\n||example.com^\n||test.org^';
    const result = precompileFilterList(filterText);
    assert.strictEqual(result.rules.length, 2);
    assert.strictEqual(result.stats.duplicates, 1);
});

runTest('Should handle various rule types', () => {
    const filterText = '||example.com^\n/banner-ad/\n@@||trusted.com^';
    const result = precompileFilterList(filterText);
    assert.strictEqual(result.rules.length, 3);
    
    // Check blocking rule
    const blockRule = findRuleByUrlFilter(result.rules, '||example.com^');
    assert(blockRule, 'Should find blocking rule');
    assert.strictEqual(blockRule.action.type, 'block');
    assert.strictEqual(blockRule.priority, 1);
    
    // Check exception rule (should have different priority and action)
    const allowRule = findRuleByUrlFilter(result.rules, '||trusted.com^');
    assert(allowRule, 'Should find exception rule');
    assert.strictEqual(allowRule.action.type, 'allow');
    assert.strictEqual(allowRule.priority, 2);
    
    // Check pattern rule
    const patternRule = findRuleByUrlFilter(result.rules, '/banner-ad/');
    assert(patternRule, 'Should find pattern rule');
    assert.strictEqual(patternRule.action.type, 'block');
});

runTest('Should handle empty input', () => {
    const result = precompileFilterList('');
    assert.strictEqual(result.rules.length, 0);
    assert.strictEqual(result.stats.processedRules, 0);
    assert.strictEqual(result.stats.totalLines, 1); // Empty string still counts as 1 line
});

// Add test for error handling with invalid rules
runTest('Should handle invalid rules gracefully', () => {
    const filterText = '||example.com^\n<script>alert(1)</script>\n||valid.com^';
    const result = precompileFilterList(filterText);
    
    // Should process valid rules and skip invalid ones
    assert.strictEqual(result.rules.length, 2);
    assert.strictEqual(result.stats.errors, 1);
    assert.strictEqual(result.stats.errorDetails.length, 1);
    
    // Check that valid rules are still processed
    const validRule = findRuleByUrlFilter(result.rules, '||example.com^');
    assert(validRule, 'Should still process valid rules');
});

// Test results summary
console.log('\n==========================================');
console.log('📊 Test Results Summary');
console.log('==========================================');

const passedTests = testResults.filter(test => test.passed);
const failedTests = testResults.filter(test => !test.passed);

console.log(`✅ Passed: ${passedTests.length}`);
console.log(`❌ Failed: ${failedTests.length}`);
console.log(`📊 Total:  ${testResults.length}`);

if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    failedTests.forEach(test => {
        console.log(`   - ${test.name}: ${test.error}`);
    });
    process.exit(1);
} else {
    console.log('\n🏆 All precompiler tests passed!');
}

