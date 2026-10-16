# Movio

Characters in motion on Solana.

[![Live site](https://img.shields.io/badge/live-movio.work?style=flat-square)](https://movio.work)
![Chain](https://img.shields.io/badge/chain-Solana?style=flat-square)

| | |
| --- | --- |
| Chain | Solana |
| CA | pending |
| Site | [movio.work](https://movio.work) |

## Overview

Movio is a Solana project built around playable personas, reactive stages and a crowd that steers what comes next. The site at [movio.work](https://movio.work) is a static page with a live window onto the Solana market.

## Features

- Contract address slot pinned to the top of the page, click to copy, inert until the address is confirmed
- Live Solana market board with logos, price, 24h change, volume, liquidity and a copy button per token
- Ticker fed by the same live data, refreshed every minute and paused while the tab is hidden
- Spring-driven entrances, parallax hero, spotlight hover and a scroll progress bar, all switched off by `prefers-reduced-motion`
- Register driven: every external fact lives in one record, and unconfirmed records render inert

## Links

- Website: [movio.work](https://movio.work)
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Develop

```bash
npm install
npm run build     # writes dist/
npm run gates     # runs every check against dist/ and against rebuilt variants
```

`dist/` is the deploy output. Drag it to Cloudflare Pages as is.

## License

MIT, see [LICENSE](LICENSE).
