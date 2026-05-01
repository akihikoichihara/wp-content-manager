# 【リリース】{{productName}}をリリースしました

{{#if date}}**{{date}}**{{/if}}

{{companyName}}は、{{productDescription}}をリリースしました。

## 製品概要

- **製品名**: {{productName}}
- **対応環境**: {{environment}}
- **価格**: {{price}}
- **主な機能**: {{mainFeatures}}

## 特長

{{#each features}}
- {{this}}
{{/each}}

{{#if detailedFeatures}}
{{detailedFeatures}}
{{/if}}

## ダウンロード・詳細

{{#if downloadUrl}}
{{#if downloadButton}}
{{downloadButton}}
{{else}}
ダウンロード: [{{productName}}]({{downloadUrl}})
{{/if}}
{{/if}}

{{#if additionalInfo}}
{{additionalInfo}}
{{/if}}

---

**{{companyName}}について**
{{companyDescription}}

**お問い合わせ**
弊社ウェブサイトの[お問い合わせフォーム]({{inquiryUrl}})または公式SNSアカウントまでお気軽にご連絡ください。