# SICasino v40 — Marketplace & Crafting

## Added
- Player marketplace for crystals and crafted artifacts.
- Players can list owned items for a custom price in SC, buy items from other players, and cancel their own active listings.
- Marketplace listings escrow the item so it cannot be sold twice or used while listed.
- 5% marketplace fee; seller receives 95% of the listed price.
- Server-side balance, ownership, listing status, and price validation for marketplace actions.
- Three crystal crafting recipes: Prismatic Core, Void Relic, and Star Heart.
- Crafted artifacts persist in the player's account and can be listed on the marketplace.
- Responsive marketplace and crafting UI inside the existing Upgrader page.

## Notes
- Existing users and balances are preserved; new arrays are initialized automatically.
- Server-side syntax and client-side syntax checks passed. Full end-to-end testing requires installing the project's dependencies and running it with a test database.
