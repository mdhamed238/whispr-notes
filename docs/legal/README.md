# Legal documents

`content/legal/*.md` are the single source for the Privacy Policy, Terms of Use and
"What's stored" page. They are embedded in the app (`yarn legal` regenerates
`content/legal/index.ts`) and published on the website (`website/build.mjs`).

**These drafts are not legal advice.** Have them reviewed before launch, in particular:

- **Governing law:** currently "the country where the developer resides". Replace with your
  country (and, if you like, a venue) once confirmed.
- **Seller name:** Mohamed Hamed (individual). Must match your App Store / Play developer name.
- **EU distribution:** as a "trader" under the EU Digital Services Act, your address and phone
  number are shown on your App Store page. A virtual address works.
- **Store privacy answers:** see `docs/store/listing.md`.
