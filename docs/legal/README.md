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
- **No analytics:** the app ships no analytics, crash-reporting or launch-counting SDK, and the
  policy says so. The one library that reports on its own (`react-native-executorch`, model
  download events) is silenced in `services/ai/quietResourceFetcher.ts`; keep that test passing. Adding one later means updating the Privacy Policy, "What's stored", the store
  privacy answers and the iOS privacy manifest in `app.json` first.
- **Feedback:** the website's `/feedback` form opens an email in the visitor's own mail app
  (no server, no storage). The policy's "Feedback" section covers what you receive.
