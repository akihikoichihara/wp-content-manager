# 【お知らせ】{{title}}

{{#if date}}**{{date}}**{{/if}}

{{introduction}}

{{#if sections}}
{{#each sections}}
## {{title}}

{{content}}

{{/each}}
{{else}}
## 詳細

{{mainContent}}
{{/if}}

{{#if additionalInfo}}
{{additionalInfo}}
{{/if}}

---

**{{companyName}}について**
{{companyDescription}}

**本件に関するお問い合わせ**
弊社ウェブサイトの[お問い合わせフォーム]({{inquiryUrl}})までお気軽にご連絡ください。