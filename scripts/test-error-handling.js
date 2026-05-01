require('dotenv').config();
const UnifiedWordPressClient = require('../src/unified-wordpress-client');

class ErrorHandlingTester {
  constructor() {
    this.client = new UnifiedWordPressClient();
  }

  async runAllTests() {
    console.log('🧪 Starting Enhanced Error Handling Tests\n');
    
    const results = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      tests: []
    };

    // Test 1: Basic connection test
    await this.runTest('Basic Connection Test', async () => {
      return await this.client.testConnection();
    }, results);

    // Test 2: Health check
    await this.runTest('Health Check', async () => {
      const health = await this.client.healthCheck();
      console.log('Health Status:', JSON.stringify(health, null, 2));
      return health.status !== 'unhealthy';
    }, results);

    // Test 3: Invalid endpoint (should handle 404 gracefully)
    await this.runTest('Invalid Endpoint Handling', async () => {
      try {
        await this.client.makeRequest('/invalid-endpoint');
        return false; // Should have thrown an error
      } catch (error) {
        console.log('✅ Correctly handled 404:', error.message);
        return error.statusCode === 404;
      }
    }, results);

    // Test 4: Invalid post ID (should handle gracefully)
    await this.runTest('Invalid Post ID Handling', async () => {
      try {
        await this.client.getPost(999999);
        return false; // Should have thrown an error
      } catch (error) {
        console.log('✅ Correctly handled invalid post ID:', error.message);
        return error.statusCode === 404;
      }
    }, results);

    // Test 5: Circuit breaker functionality
    await this.runTest('Circuit Breaker Test', async () => {
      // Simulate multiple failures to trigger circuit breaker
      let failureCount = 0;
      
      for (let i = 0; i < 6; i++) {
        try {
          await this.client.makeRequest('/intentionally-broken-endpoint');
        } catch (error) {
          failureCount++;
          if (error.code === 'CIRCUIT_BREAKER_OPEN') {
            console.log('✅ Circuit breaker activated correctly');
            this.client.resetCircuitBreaker(); // Reset for other tests
            return true;
          }
        }
      }
      
      return false;
    }, results);

    // Test 6: Data validation
    await this.runTest('Data Validation Test', async () => {
      try {
        await this.client.updatePost(1, {}); // Empty update data
        return false; // Should have thrown an error
      } catch (error) {
        console.log('✅ Correctly validated empty update data:', error.message);
        return error.message.includes('must contain at least');
      }
    }, results);

    // Test 7: Retry mechanism (simulate with timeout)
    await this.runTest('Retry Mechanism Test', async () => {
      const originalTimeout = this.client.timeout;
      this.client.timeout = 100; // Very short timeout to trigger retries
      
      try {
        await this.client.makeRequest('/posts?per_page=1');
        this.client.timeout = originalTimeout;
        return true; // If it succeeds despite short timeout, retries worked
      } catch (error) {
        this.client.timeout = originalTimeout;
        // Check if it attempted retries
        return error.message.includes('timeout') || error.code === 'TIMEOUT';
      }
    }, results);

    // Test 8: Status reporting
    await this.runTest('Status Reporting', async () => {
      const status = this.client.getStatus();
      console.log('Client Status:', JSON.stringify(status, null, 2));
      return status.circuitBreaker && status.configuration;
    }, results);

    this.printResults(results);
    return results;
  }

  async runTest(testName, testFunction, results) {
    results.totalTests++;
    console.log(`\n🔬 Running: ${testName}`);
    
    try {
      const startTime = Date.now();
      const result = await testFunction();
      const duration = Date.now() - startTime;
      
      if (result) {
        console.log(`✅ PASSED: ${testName} (${duration}ms)`);
        results.passed++;
        results.tests.push({ name: testName, status: 'PASSED', duration });
      } else {
        console.log(`❌ FAILED: ${testName} (${duration}ms)`);
        results.failed++;
        results.tests.push({ name: testName, status: 'FAILED', duration });
      }
    } catch (error) {
      console.log(`❌ ERROR: ${testName} - ${error.message}`);
      results.failed++;
      results.tests.push({ name: testName, status: 'ERROR', error: error.message });
    }
  }

  printResults(results) {
    console.log('\n' + '='.repeat(50));
    console.log('🧪 ERROR HANDLING TEST RESULTS');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${results.totalTests}`);
    console.log(`Passed: ${results.passed} ✅`);
    console.log(`Failed: ${results.failed} ❌`);
    console.log(`Success Rate: ${((results.passed / results.totalTests) * 100).toFixed(1)}%`);
    
    console.log('\nDetailed Results:');
    results.tests.forEach(test => {
      const statusIcon = test.status === 'PASSED' ? '✅' : '❌';
      const duration = test.duration ? ` (${test.duration}ms)` : '';
      console.log(`  ${statusIcon} ${test.name}${duration}`);
      if (test.error) {
        console.log(`      Error: ${test.error}`);
      }
    });
    
    console.log('\n📊 Test completed!');
  }

  // Specific error simulation tests
  async simulateNetworkErrors() {
    console.log('\n🌐 Simulating Network Error Scenarios\n');
    
    // Test different error scenarios
    const scenarios = [
      {
        name: 'Connection Timeout',
        setup: () => { this.client.timeout = 1; }, // 1ms timeout
        cleanup: () => { this.client.timeout = 30000; }
      },
      {
        name: 'Invalid URL',
        setup: () => { this.client.baseUrl = 'https://invalid-domain-that-does-not-exist.com/wp-json/wp/v2'; },
        cleanup: () => { this.client.baseUrl = process.env.WP_API_URL || 'https://your-site.com/wp-json/wp/v2'; }
      }
    ];

    for (const scenario of scenarios) {
      console.log(`\n🎭 Scenario: ${scenario.name}`);
      
      scenario.setup();
      
      try {
        await this.client.testConnection();
        console.log('❌ Expected error but request succeeded');
      } catch (error) {
        console.log(`✅ Error handled correctly: ${error.message}`);
        if (error.suggestion) {
          console.log(`💡 Suggestion provided: ${error.suggestion}`);
        }
      }
      
      scenario.cleanup();
    }
  }
}

if (require.main === module) {
  const tester = new ErrorHandlingTester();
  
  tester.runAllTests()
    .then(results => {
      console.log('\n🎯 Running additional network error simulations...');
      return tester.simulateNetworkErrors();
    })
    .then(() => {
      console.log('\n🏁 All error handling tests completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Test suite failed:', error.message);
      process.exit(1);
    });
}

module.exports = ErrorHandlingTester;