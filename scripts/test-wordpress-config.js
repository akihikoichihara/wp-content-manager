#!/usr/bin/env node

/**
 * Test script for WordPress configuration management
 * Verifies that hardcoded taxonomy IDs have been successfully replaced
 */

const WordPressConfig = require('../config/wordpress/index.js');

console.log('🧪 Testing WordPress Configuration Management System\n');

// Test 1: Load and verify configuration
console.log('Test 1: Configuration Loading');
console.log('============================');
try {
  const categoriesCount = WordPressConfig.categories && WordPressConfig.categories.categories 
    ? Object.keys(WordPressConfig.categories.categories).length 
    : 0;
  const tagsCount = WordPressConfig.tags && WordPressConfig.tags.tags 
    ? Object.keys(WordPressConfig.tags.tags).length 
    : 0;
    
  console.log('✅ Configuration loaded successfully');
  console.log(`Categories loaded: ${categoriesCount}`);
  console.log(`Tags loaded: ${tagsCount}`);
  
  if (categoriesCount === 0 || tagsCount === 0) {
    console.error('⚠️  Warning: No categories or tags found in configuration');
  }
} catch (error) {
  console.error('❌ Failed to load configuration:', error.message);
  process.exit(1);
}

// Test 2: Category management
console.log('\nTest 2: Category Management');
console.log('===========================');

// Test default category
const defaultCategoryId = WordPressConfig.getDefaultCategoryId();
console.log(`Default category ID: ${defaultCategoryId}`);
const defaultCategory = WordPressConfig.getCategoryById(defaultCategoryId);
console.log(`Default category: ${defaultCategory?.name} (${defaultCategory?.slug})`);

// Test category lookup
const announcementCategory = WordPressConfig.getCategoryBySlug('announcement');
console.log(`Announcement category: ID=${announcementCategory?.id}, Name="${announcementCategory?.name}"`);

// Test category mapping
const noteMapping = WordPressConfig.getCategoryMapping('note-article');
console.log(`Note article mapping: ${noteMapping?.name || 'Not found'}`);

// Test 3: Tag management
console.log('\nTest 3: Tag Management');
console.log('======================');

// Test tag lookup
const noteTag = WordPressConfig.getTagBySlug('note');
const techpediaTag = WordPressConfig.getTagBySlug('techpedia');
console.log(`Note tag: ID=${noteTag?.id}, Name="${noteTag?.name}"`);
console.log(`Techpedia tag: ID=${techpediaTag?.id}, Name="${techpediaTag?.name}"`);

// Test tag mapping
const noteAnnouncementTags = WordPressConfig.getTagIdsByMapping('note-announcement');
console.log(`Note announcement tags: [${noteAnnouncementTags.join(', ')}]`);
const tagNames = noteAnnouncementTags.map(id => WordPressConfig.getTagById(id)?.name);
console.log(`Tag names: ${tagNames.join(', ')}`);

// Test 4: Validation
console.log('\nTest 4: ID Validation');
console.log('=====================');

// Test valid IDs
console.log(`Category ID 2 is valid: ${WordPressConfig.validateCategoryId(2)}`);
console.log(`Tag ID 126 is valid: ${WordPressConfig.validateTagId(126)}`);
console.log(`Tag ID 114 is valid: ${WordPressConfig.validateTagId(114)}`);

// Test invalid IDs
console.log(`Category ID 999 is valid: ${WordPressConfig.validateCategoryId(999)}`);
console.log(`Tag ID 999 is valid: ${WordPressConfig.validateTagId(999)}`);

// Test 5: Compare with previous hardcoded values
console.log('\nTest 5: Hardcoded Values Replacement');
console.log('====================================');
console.log('Previous hardcoded values:');
console.log('  categories: [2]');
console.log('  tags: [126, 114]');
console.log('\nCurrent configuration-based values:');
console.log(`  categories: [${defaultCategoryId}]`);
console.log(`  tags: [${noteAnnouncementTags.join(', ')}]`);

// Verify match
const categoriesMatch = defaultCategoryId === 2;
const tagsMatch = JSON.stringify(noteAnnouncementTags.sort()) === JSON.stringify([126, 114].sort());

console.log('\nVerification Results:');
console.log(`  Categories match: ${categoriesMatch ? '✅' : '❌'}`);
console.log(`  Tags match: ${tagsMatch ? '✅' : '❌'}`);

// Test 6: List all available taxonomies
console.log('\nTest 6: Available Taxonomies');
console.log('============================');
console.log('Categories:');
WordPressConfig.getAllCategories().forEach(cat => {
  console.log(`  - ${cat.name} (ID: ${cat.id}, slug: ${cat.slug})`);
});

console.log('\nTags:');
WordPressConfig.getAllTags().forEach(tag => {
  console.log(`  - ${tag.name} (ID: ${tag.id}, slug: ${tag.slug})`);
});

// Summary
console.log('\n🎯 Test Summary');
console.log('==============');
const allTestsPassed = categoriesMatch && tagsMatch;
if (allTestsPassed) {
  console.log('✅ All tests passed! Hardcoded values have been successfully replaced with configuration-based values.');
} else {
  console.log('❌ Some tests failed. Please check the configuration files.');
}

console.log('\n💡 Usage in scripts:');
console.log('const wpConfig = require("../config/wordpress");');
console.log('const categoryId = wpConfig.getDefaultCategoryId();');
console.log('const tagIds = wpConfig.getTagIdsByMapping("note-announcement");');

process.exit(allTestsPassed ? 0 : 1);