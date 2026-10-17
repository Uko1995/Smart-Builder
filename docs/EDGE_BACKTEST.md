# Edge backtest (#2)

Generated 2026-10-15T11:38:23.566Z. Seasons tested: 2020/2021, 2021/2022, 2022/2023, 2023/2024, 2024/2025, 2025/2026, 2026/2027.

## Verdict

**Nothing we forecast beats the closing line.** No segment (league or all-league market × source × price) has closing-line value with a bootstrap 95% interval above zero that also held in the confirmation season and beat the market-only control. Expected-value picks are not shipped for any segment.

Multiple testing: 182 segments had enough bets; by chance alone about 4.5 would show a CLV interval above zero. 5 did, 0 of those also beat the market-only control, and 0 passed every test.

Blend weights fitted on all seasons: 1X2 model 0.00, elo 0.00, market 1.02; over/under 2.5 model 0.06, market 0.92. A weight near zero means that forecast adds nothing to the early market price.

## Method

- Benchmark: Pinnacle closing before 2025-07-23, then Betfair Exchange closing, then market-average closing, margin removed with the power method. Closing sources used: pinnacle 118363, market_average 1634, betfair_exchange 22580.
- Model: Dixon–Coles goal rates from the previous 1100 days, rho picked per league at each season start. Elo: per-league ratings updated after every match, logit refitted at each season start. Market: power-devigged average early price. Blend: log-linear pool of model, Elo (1X2 only) and market, weights fitted on earlier seasons only.
- Betting rule: one bet per match and market, on the selection with the highest expected value if it exceeds 5%; stake = quarter Kelly capped at 5% of a flat 100-unit bankroll.
- Price bases: `best_early` = best early price across books (football-data `Max`, includes line-shopping), `bet365_early` = a single realistic book, `best_closing` = best closing price (only for leagues with no early prices; not achievable before kick-off, shown for reference).
- Control: `market` bets the de-margined early market-average price at the same prices. It uses no forecast of ours, so any CLV it shows comes from price shopping (an outlying best price against the consensus), not from modelling.
- CLV = price taken × fair closing probability − 1. Intervals: 1000-sample bootstrap, 95% percentile.

## Log loss against the closing line

Lower is better. `Δ` = source minus closing on the same matches, with a 95% interval; a negative Δ would mean beating the close.

| League | Market | Matches | Closing | Model Δ | Elo Δ | Blend Δ | Early market Δ |
|---|---|---|---|---|---|---|---|
| All leagues | ou25 | 48544 | 0.6744 | 0.0143 [0.0129, 0.0159] | – | 0.0026 [0.0020, 0.0032] | 0.0024 [0.0018, 0.0029] |
| All leagues | 1x2 | 78231 | 1.0003 | 0.0352 [0.0333, 0.0371] | 0.0221 [0.0207, 0.0235] | 0.0040 [0.0030, 0.0049] | 0.0037 [0.0029, 0.0045] |
| England Premier League | 1x2 | 2406 | 0.9643 | 0.0418 [0.0321, 0.0517] | 0.0220 [0.0149, 0.0295] | 0.0040 [0.0007, 0.0069] | 0.0043 [0.0013, 0.0072] |
| England Premier League | ou25 | 2406 | 0.6745 | 0.0117 [0.0059, 0.0179] | – | 0.0011 [-0.0014, 0.0037] | 0.0009 [-0.0015, 0.0033] |
| Germany Bundesliga | 1x2 | 1881 | 0.9745 | 0.0370 [0.0236, 0.0485] | 0.0207 [0.0124, 0.0292] | 0.0037 [0.0007, 0.0074] | 0.0032 [0.0001, 0.0065] |
| Germany Bundesliga | ou25 | 1881 | 0.6435 | 0.0203 [0.0132, 0.0277] | – | 0.0034 [0.0004, 0.0064] | 0.0029 [-0.0003, 0.0058] |
| Germany 2. Bundesliga | 1x2 | 1899 | 1.0356 | 0.0183 [0.0084, 0.0278] | 0.0197 [0.0123, 0.0283] | 0.0013 [-0.0026, 0.0049] | 0.0007 [-0.0026, 0.0040] |
| Germany 2. Bundesliga | ou25 | 1899 | 0.6705 | 0.0149 [0.0086, 0.0212] | – | 0.0016 [-0.0014, 0.0043] | 0.0018 [-0.0008, 0.0042] |
| Italy Serie A | 1x2 | 2438 | 0.9593 | 0.0483 [0.0387, 0.0589] | 0.0217 [0.0137, 0.0285] | 0.0027 [-0.0008, 0.0061] | 0.0024 [-0.0006, 0.0056] |
| Italy Serie A | ou25 | 2438 | 0.6807 | 0.0079 [0.0017, 0.0147] | – | 0.0019 [-0.0008, 0.0050] | 0.0023 [-0.0002, 0.0050] |
| Italy Serie B | 1x2 | 2407 | 1.0401 | 0.0355 [0.0266, 0.0453] | 0.0216 [0.0138, 0.0308] | 0.0084 [0.0041, 0.0126] | 0.0073 [0.0037, 0.0108] |
| Italy Serie B | ou25 | 2407 | 0.6850 | 0.0150 [0.0080, 0.0216] | – | 0.0016 [-0.0009, 0.0043] | 0.0008 [-0.0016, 0.0030] |
| Spain La Liga | 1x2 | 2415 | 0.9655 | 0.0410 [0.0311, 0.0514] | 0.0210 [0.0138, 0.0286] | 0.0020 [-0.0013, 0.0052] | 0.0018 [-0.0015, 0.0050] |
| Spain La Liga | ou25 | 2415 | 0.6661 | 0.0154 [0.0083, 0.0225] | – | 0.0024 [-0.0004, 0.0054] | 0.0025 [-0.0004, 0.0053] |
| Spain Segunda Division | 1x2 | 2935 | 1.0299 | 0.0235 [0.0159, 0.0316] | 0.0180 [0.0109, 0.0249] | 0.0029 [-0.0008, 0.0064] | 0.0023 [-0.0010, 0.0058] |
| Spain Segunda Division | ou25 | 2935 | 0.6639 | 0.0166 [0.0106, 0.0230] | – | 0.0029 [0.0005, 0.0055] | 0.0019 [-0.0003, 0.0043] |
| France Ligue 1 | 1x2 | 2112 | 0.9854 | 0.0361 [0.0233, 0.0475] | 0.0238 [0.0149, 0.0319] | 0.0006 [-0.0031, 0.0042] | 0.0008 [-0.0023, 0.0044] |
| France Ligue 1 | ou25 | 2112 | 0.6721 | 0.0220 [0.0153, 0.0297] | – | 0.0061 [0.0031, 0.0090] | 0.0050 [0.0019, 0.0082] |
| France Ligue 2 | 1x2 | 2202 | 1.0350 | 0.0348 [0.0253, 0.0442] | 0.0277 [0.0199, 0.0355] | 0.0077 [0.0038, 0.0113] | 0.0073 [0.0037, 0.0108] |
| France Ligue 2 | ou25 | 2202 | 0.6749 | 0.0187 [0.0116, 0.0262] | – | 0.0040 [0.0010, 0.0072] | 0.0034 [0.0007, 0.0057] |
| Netherlands Eredivisie | 1x2 | 1908 | 0.9367 | 0.0423 [0.0265, 0.0555] | 0.0186 [0.0067, 0.0290] | 0.0029 [-0.0060, 0.0100] | 0.0026 [-0.0086, 0.0091] |
| Netherlands Eredivisie | ou25 | 1908 | 0.6569 | 0.0149 [0.0076, 0.0222] | – | 0.0033 [0.0001, 0.0066] | 0.0032 [0.0003, 0.0061] |
| Belgium Pro League | 1x2 | 1925 | 0.9837 | 0.0461 [0.0346, 0.0569] | 0.0240 [0.0163, 0.0330] | 0.0086 [0.0047, 0.0126] | 0.0083 [0.0043, 0.0126] |
| Belgium Pro League | ou25 | 1925 | 0.6743 | 0.0116 [0.0036, 0.0189] | – | 0.0035 [0.0001, 0.0066] | 0.0033 [0.0002, 0.0062] |
| England Championship | 1x2 | 3508 | 1.0350 | 0.0207 [0.0135, 0.0276] | 0.0147 [0.0080, 0.0204] | 0.0005 [-0.0022, 0.0030] | 0.0001 [-0.0022, 0.0023] |
| England Championship | ou25 | 3508 | 0.6815 | 0.0118 [0.0070, 0.0169] | – | 0.0015 [-0.0003, 0.0034] | 0.0016 [-0.0002, 0.0033] |
| Portugal Primeira Liga | 1x2 | 1954 | 0.9084 | 0.0636 [0.0506, 0.0745] | 0.0210 [0.0130, 0.0304] | 0.0063 [0.0023, 0.0100] | 0.0068 [0.0025, 0.0106] |
| Portugal Primeira Liga | ou25 | 1954 | 0.6696 | 0.0178 [0.0099, 0.0257] | – | 0.0046 [0.0021, 0.0075] | 0.0045 [0.0018, 0.0071] |
| Turkey Super Lig | 1x2 | 2249 | 0.9701 | 0.0436 [0.0333, 0.0537] | 0.0260 [0.0170, 0.0349] | 0.0065 [0.0027, 0.0110] | 0.0065 [0.0025, 0.0105] |
| Turkey Super Lig | ou25 | 2249 | 0.6694 | 0.0230 [0.0166, 0.0295] | – | 0.0056 [0.0027, 0.0086] | 0.0056 [0.0025, 0.0085] |
| Greece Super League | 1x2 | 1501 | 0.9427 | 0.0545 [0.0367, 0.0698] | 0.0394 [0.0277, 0.0516] | 0.0081 [0.0020, 0.0140] | 0.0091 [0.0035, 0.0148] |
| Greece Super League | ou25 | 1501 | 0.6727 | 0.0157 [0.0064, 0.0237] | – | 0.0044 [0.0003, 0.0086] | 0.0039 [-0.0003, 0.0083] |
| Argentina Liga Profesional | 1x2 | 3322 | 1.0538 | 0.0145 [0.0066, 0.0221] | 0.0126 [0.0063, 0.0190] | – | – |
| Austria Bundesliga | 1x2 | 1226 | 1.0041 | 0.0349 [0.0192, 0.0518] | 0.0198 [0.0077, 0.0317] | – | – |
| Brazil Serie A | 1x2 | 2579 | 1.0049 | 0.0321 [0.0227, 0.0414] | 0.0235 [0.0149, 0.0314] | – | – |
| China Super League | 1x2 | 1578 | 0.9104 | 0.0873 [0.0706, 0.1034] | 0.0596 [0.0429, 0.0766] | – | – |
| Denmark Superliga | 1x2 | 1249 | 1.0138 | 0.0375 [0.0245, 0.0500] | 0.0205 [0.0105, 0.0296] | – | – |
| Finland Veikkausliiga | 1x2 | 1140 | 0.9772 | 0.0509 [0.0359, 0.0663] | 0.0276 [0.0157, 0.0402] | – | – |
| Ireland Premier Division | 1x2 | 1144 | 1.0016 | 0.0357 [0.0202, 0.0531] | 0.0210 [0.0090, 0.0325] | – | – |
| England League One | 1x2 | 3414 | 1.0154 | 0.0311 [0.0240, 0.0374] | 0.0212 [0.0147, 0.0283] | 0.0040 [0.0013, 0.0065] | 0.0032 [0.0008, 0.0053] |
| England League One | ou25 | 3414 | 0.6845 | 0.0137 [0.0088, 0.0187] | – | 0.0010 [-0.0009, 0.0031] | 0.0008 [-0.0009, 0.0027] |
| Japan J1 League | 1x2 | 2143 | 1.0308 | 0.0266 [0.0173, 0.0356] | 0.0155 [0.0077, 0.0233] | – | – |
| Mexico Liga MX | 1x2 | 2139 | 1.0031 | 0.0319 [0.0222, 0.0403] | 0.0210 [0.0135, 0.0280] | – | – |
| Norway Eliteserien | 1x2 | 1591 | 0.9629 | 0.0428 [0.0302, 0.0547] | 0.0215 [0.0119, 0.0306] | – | – |
| Poland Ekstraklasa | 1x2 | 1890 | 1.0343 | 0.0260 [0.0152, 0.0373] | 0.0169 [0.0095, 0.0262] | – | – |
| Romania Liga 1 | 1x2 | 2050 | 0.9967 | 0.0512 [0.0391, 0.0628] | 0.0296 [0.0202, 0.0391] | – | – |
| Russia Premier League | 1x2 | 1433 | 0.9780 | 0.0383 [0.0228, 0.0545] | 0.0119 [0.0003, 0.0240] | – | – |
| Sweden Allsvenskan | 1x2 | 1600 | 0.9963 | 0.0380 [0.0248, 0.0503] | 0.0323 [0.0222, 0.0415] | – | – |
| Switzerland Super League | 1x2 | 1341 | 1.0256 | 0.0265 [0.0121, 0.0388] | 0.0188 [0.0087, 0.0293] | – | – |
| USA MLS | 1x2 | 3262 | 1.0260 | 0.0233 [0.0171, 0.0299] | 0.0226 [0.0166, 0.0298] | – | – |
| England League Two | 1x2 | 3426 | 1.0469 | 0.0251 [0.0186, 0.0318] | 0.0208 [0.0139, 0.0271] | 0.0039 [0.0014, 0.0063] | 0.0040 [0.0016, 0.0066] |
| England League Two | ou25 | 3426 | 0.6802 | 0.0154 [0.0106, 0.0206] | – | 0.0032 [0.0013, 0.0049] | 0.0017 [-0.0003, 0.0037] |
| England National League | 1x2 | 3346 | 1.0015 | 0.0286 [0.0209, 0.0368] | 0.0191 [0.0135, 0.0254] | 0.0032 [-0.0002, 0.0067] | 0.0029 [-0.0006, 0.0060] |
| England National League | ou25 | 3346 | 0.6798 | 0.0065 [0.0015, 0.0109] | – | 0.0019 [-0.0002, 0.0039] | 0.0025 [0.0006, 0.0045] |
| Scotland Premiership | 1x2 | 1416 | 0.9336 | 0.0441 [0.0297, 0.0580] | 0.0213 [0.0116, 0.0296] | 0.0021 [-0.0022, 0.0065] | 0.0017 [-0.0025, 0.0060] |
| Scotland Premiership | ou25 | 1416 | 0.6749 | 0.0141 [0.0054, 0.0231] | – | 0.0008 [-0.0026, 0.0044] | 0.0007 [-0.0029, 0.0038] |
| Scotland Championship | 1x2 | 1083 | 1.0381 | 0.0335 [0.0195, 0.0489] | 0.0289 [0.0185, 0.0401] | 0.0088 [0.0036, 0.0145] | 0.0091 [0.0043, 0.0136] |
| Scotland Championship | ou25 | 1083 | 0.6824 | 0.0158 [0.0069, 0.0251] | – | 0.0050 [0.0017, 0.0091] | 0.0044 [0.0007, 0.0079] |
| Scotland League One | 1x2 | 1059 | 0.9963 | 0.0405 [0.0226, 0.0579] | 0.0272 [0.0112, 0.0424] | -0.0007 [-0.0086, 0.0066] | -0.0003 [-0.0071, 0.0055] |
| Scotland League One | ou25 | 1059 | 0.6834 | 0.0052 [-0.0062, 0.0138] | – | -0.0021 [-0.0059, 0.0019] | -0.0006 [-0.0044, 0.0032] |
| Scotland League Two | 1x2 | 1060 | 1.0391 | 0.0231 [0.0076, 0.0400] | 0.0200 [0.0073, 0.0333] | 0.0033 [-0.0033, 0.0103] | 0.0026 [-0.0032, 0.0089] |
| Scotland League Two | ou25 | 1060 | 0.6932 | 0.0039 [-0.0051, 0.0125] | – | -0.0024 [-0.0064, 0.0012] | -0.0015 [-0.0055, 0.0024] |

## Betting simulation, all leagues

| Threshold | Market | Source | Prices | Bets | Profit (units) | ROI [95% CI] | CLV [95% CI] |
|---|---|---|---|---|---|---|---|
| 5% | 1x2 | blend | best_early | 2329 | 134.28 | 11.1% [2.0%, 21.0%] | 2.3% [1.5%, 3.0%] |
| 5% | 1x2 | blend | bet365_early | 402 | -13.7 | -7.2% [-28.2%, 14.8%] | 1.4% [-0.0%, 3.1%] |
| 5% | 1x2 | elo | best_closing | 23848 | -1509.67 | -2.6% [-4.9%, -0.1%] | -1.1% [-1.6%, -0.3%] |
| 5% | 1x2 | elo | best_early | 36119 | -4457.79 | -5.7% [-7.3%, -4.1%] | -2.7% [-2.9%, -2.6%] |
| 5% | 1x2 | elo | bet365_early | 26060 | -5654.83 | -10.3% [-12.2%, -8.3%] | -7.5% [-7.7%, -7.4%] |
| 5% | 1x2 | market | best_early | 837 | 127.03 | 18.2% [6.1%, 30.8%] | 6.5% [5.3%, 7.6%] |
| 5% | 1x2 | market | bet365_early | 135 | -6.02 | -8.0% [-43.7%, 34.1%] | 2.6% [0.1%, 5.1%] |
| 5% | 1x2 | model | best_closing | 25343 | -2375.63 | -3.6% [-6.1%, -1.0%] | -1.4% [-1.9%, -0.7%] |
| 5% | 1x2 | model | best_early | 38841 | -7660.73 | -8.2% [-10.1%, -6.1%] | -3.4% [-3.5%, -3.3%] |
| 5% | 1x2 | model | bet365_early | 32192 | -10054.71 | -13.6% [-15.7%, -11.4%] | -9.0% [-9.2%, -8.9%] |
| 5% | ou25 | blend | best_early | 150 | 29.23 | 10.0% [-12.7%, 31.7%] | 8.9% [6.4%, 11.4%] |
| 5% | ou25 | blend | bet365_early | 6 | -1.51 | -13.4% [-100.0%, 41.8%] | 2.7% [-5.8%, 10.0%] |
| 5% | ou25 | market | best_early | 103 | 64.85 | 23.9% [-0.8%, 50.0%] | 16.0% [13.2%, 19.1%] |
| 5% | ou25 | market | bet365_early | 5 | -4.41 | -30.1% [-100.0%, 43.8%] | 10.2% [-3.5%, 29.2%] |
| 5% | ou25 | model | best_closing | 9 | 8.42 | 23.9% [-42.7%, 86.4%] | -7.4% [-12.6%, -3.0%] |
| 5% | ou25 | model | best_early | 27199 | -3104.89 | -3.6% [-4.8%, -2.3%] | -2.4% [-2.5%, -2.3%] |
| 5% | ou25 | model | bet365_early | 20397 | -4474.92 | -7.0% [-8.5%, -5.3%] | -5.6% [-5.7%, -5.4%] |
| 2% | 1x2 | blend | best_early | 7373 | 128.09 | 3.7% [-0.1%, 7.9%] | 0.6% [0.3%, 0.9%] |
| 2% | 1x2 | blend | bet365_early | 1287 | -7.98 | -2.0% [-15.2%, 10.6%] | -0.9% [-1.6%, -0.0%] |
| 2% | 1x2 | elo | best_closing | 26583 | -1585.8 | -2.7% [-4.8%, -0.2%] | -1.2% [-1.6%, -0.5%] |
| 2% | 1x2 | elo | best_early | 41848 | -4506.11 | -5.5% [-7.1%, -4.0%] | -2.6% [-2.7%, -2.5%] |
| 2% | 1x2 | elo | bet365_early | 32233 | -5914.16 | -10.0% [-11.8%, -8.2%] | -7.3% [-7.4%, -7.1%] |
| 2% | 1x2 | market | best_early | 4348 | 166.69 | 6.9% [1.9%, 11.5%] | 3.0% [2.6%, 3.4%] |
| 2% | 1x2 | market | bet365_early | 631 | 0.75 | 0.4% [-15.8%, 17.2%] | 0.8% [-0.3%, 2.0%] |
| 2% | 1x2 | model | best_closing | 27189 | -2451.37 | -3.6% [-6.3%, -1.1%] | -1.4% [-1.9%, -0.8%] |
| 2% | 1x2 | model | best_early | 42491 | -7750.1 | -8.1% [-10.2%, -6.2%] | -3.3% [-3.4%, -3.2%] |
| 2% | 1x2 | model | bet365_early | 36321 | -10277.32 | -13.5% [-15.6%, -11.3%] | -8.7% [-8.9%, -8.6%] |
| 2% | ou25 | blend | best_early | 1564 | 32.78 | 2.7% [-4.9%, 9.8%] | 1.3% [0.8%, 1.8%] |
| 2% | ou25 | blend | bet365_early | 73 | -4.42 | -9.4% [-37.3%, 14.4%] | -1.0% [-3.3%, 1.2%] |
| 2% | ou25 | market | best_early | 719 | 96.74 | 12.0% [2.3%, 22.2%] | 5.2% [4.5%, 5.9%] |
| 2% | ou25 | market | bet365_early | 28 | -1.55 | -4.8% [-45.6%, 38.8%] | 2.4% [-1.3%, 6.8%] |
| 2% | ou25 | model | best_closing | 13 | 7.54 | 18.6% [-38.6%, 74.9%] | -5.6% [-9.5%, -2.4%] |
| 2% | ou25 | model | best_early | 34199 | -3151.39 | -3.3% [-4.7%, -2.1%] | -2.3% [-2.4%, -2.2%] |
| 2% | ou25 | model | bet365_early | 26716 | -4741.15 | -6.7% [-8.0%, -5.3%] | -5.4% [-5.5%, -5.3%] |
| 10% | 1x2 | blend | best_early | 552 | 101.74 | 28.8% [4.6%, 53.7%] | 6.2% [4.3%, 8.0%] |
| 10% | 1x2 | blend | bet365_early | 90 | -14.52 | -22.2% [-64.1%, 31.0%] | 1.9% [-1.6%, 5.7%] |
| 10% | 1x2 | elo | best_closing | 19024 | -1387.87 | -2.7% [-5.2%, -0.0%] | -1.0% [-1.6%, -0.0%] |
| 10% | 1x2 | elo | best_early | 26317 | -4242.32 | -6.5% [-8.5%, -4.5%] | -3.0% [-3.2%, -2.9%] |
| 10% | 1x2 | elo | bet365_early | 17912 | -4790.05 | -10.9% [-13.3%, -8.5%] | -8.0% [-8.2%, -7.8%] |
| 10% | 1x2 | market | best_early | 119 | 79.8 | 46.5% [10.3%, 81.8%] | 14.5% [10.2%, 18.9%] |
| 10% | 1x2 | market | bet365_early | 20 | -9.43 | -31.9% [-100.0%, 59.4%] | 1.1% [-7.5%, 7.1%] |
| 10% | 1x2 | model | best_closing | 21651 | -2277.29 | -3.7% [-6.5%, -0.7%] | -1.4% [-1.9%, -0.5%] |
| 10% | 1x2 | model | best_early | 32179 | -7351.08 | -8.5% [-10.8%, -6.3%] | -3.7% [-3.8%, -3.5%] |
| 10% | 1x2 | model | bet365_early | 26201 | -9672.27 | -14.3% [-16.7%, -11.8%] | -9.6% [-9.7%, -9.4%] |
| 10% | ou25 | blend | best_early | 41 | 24.16 | 15.3% [-24.4%, 54.2%] | 24.1% [18.9%, 29.0%] |
| 10% | ou25 | market | best_early | 41 | 43.07 | 25.4% [-13.8%, 64.0%] | 26.8% [21.9%, 32.0%] |
| 10% | ou25 | market | bet365_early | 3 | -4.23 | -35.6% [-100.0%, 53.0%] | 20.6% [7.0%, 43.9%] |
| 10% | ou25 | model | best_closing | 6 | 8.17 | 28.0% [-41.9%, 98.6%] | -9.0% [-16.4%, -3.1%] |
| 10% | ou25 | model | best_early | 17427 | -2860.23 | -4.2% [-5.8%, -2.6%] | -2.5% [-2.6%, -2.4%] |
| 10% | ou25 | model | bet365_early | 12294 | -3543.05 | -7.4% [-9.3%, -5.6%] | -5.9% [-6.0%, -5.8%] |

## Best league segments by CLV lower bound

Top 25 segments with at least the minimum number of bets.

| League | Market | Source | Prices | Bets | ROI [95% CI] | CLV [95% CI] | Control CLV | Confirmation CLV (bets) | Approved |
|---|---|---|---|---|---|---|---|---|---|
| England Premier League | 1x2 | blend | best_early | 233 | 12.3% [-18.0%, 47.4%] | 4.5% [2.3%, 6.6%] | 9.9% | 21.9% (11) | no |
| England League One | 1x2 | blend | best_early | 125 | 14.8% [-16.6%, 45.6%] | 4.0% [1.8%, 6.4%] | 4.4% | 11.1% (9) | no |
| Germany Bundesliga | 1x2 | blend | best_early | 133 | 0.7% [-34.9%, 41.9%] | 3.1% [0.7%, 5.9%] | 4.7% | 19.4% (2) | no |
| Russia Premier League | 1x2 | elo | best_closing | 1105 | 15.2% [-0.4%, 33.5%] | 1.1% [-0.0%, 2.5%] | – | 13.5% (79) | no |
| Spain La Liga | 1x2 | blend | best_early | 192 | 17.9% [-17.8%, 56.8%] | 1.9% [-0.8%, 4.5%] | 10.3% | 23.6% (5) | no |
| Russia Premier League | 1x2 | model | best_closing | 1216 | 5.4% [-10.6%, 21.9%] | 0.3% [-1.0%, 1.4%] | – | 0.6% (107) | no |
| Japan J1 League | 1x2 | elo | best_closing | 1880 | 0.6% [-7.1%, 8.2%] | -0.9% [-1.2%, -0.7%] | – | -3.7% (190) | no |
| Japan J1 League | 1x2 | model | best_closing | 1788 | -4.4% [-13.5%, 4.6%] | -1.0% [-1.2%, -0.8%] | – | -3.3% (176) | no |
| USA MLS | 1x2 | elo | best_closing | 2621 | -6.0% [-12.4%, -0.2%] | -1.0% [-1.2%, -0.9%] | – | -3.2% (500) | no |
| France Ligue 1 | 1x2 | blend | best_early | 184 | 14.5% [-18.4%, 46.2%] | 1.1% [-1.2%, 3.5%] | 7.3% | 13.0% (3) | no |
| Italy Serie A | 1x2 | elo | best_early | 1874 | -7.1% [-13.2%, -0.9%] | -0.9% [-1.4%, -0.4%] | 9.8% | -4.8% (283) | no |
| England Premier League | 1x2 | elo | best_early | 1926 | -1.8% [-9.4%, 6.0%] | -0.9% [-1.4%, -0.4%] | 9.9% | -1.8% (327) | no |
| Italy Serie A | 1x2 | blend | best_early | 266 | 1.5% [-30.9%, 38.1%] | 0.8% [-1.4%, 3.2%] | 9.8% | 45.9% (4) | no |
| England Premier League | 1x2 | model | best_early | 2190 | -4.2% [-13.0%, 4.8%] | -1.0% [-1.5%, -0.5%] | 9.9% | -2.6% (380) | no |
| USA MLS | 1x2 | model | best_closing | 2769 | -3.8% [-9.7%, 2.7%] | -1.4% [-1.5%, -1.3%] | – | -4.0% (527) | no |
| Italy Serie B | 1x2 | elo | best_early | 2055 | -8.2% [-15.2%, -1.6%] | -1.2% [-1.6%, -0.9%] | 3.7% | -3.4% (373) | no |
| Brazil Serie A | 1x2 | elo | best_closing | 2155 | -3.8% [-10.5%, 3.7%] | -1.6% [-1.8%, -1.4%] | – | -4.6% (416) | no |
| Argentina Liga Profesional | 1x2 | model | best_closing | 2877 | 8.3% [0.1%, 17.0%] | 1.2% [-1.8%, 6.9%] | – | 10.4% (556) | no |
| Mexico Liga MX | 1x2 | model | best_closing | 1901 | -7.1% [-15.5%, 1.1%] | -1.2% [-1.9%, -0.3%] | – | -0.4% (351) | no |
| England League One | ou25 | model | best_early | 1757 | -7.5% [-12.2%, -2.7%] | -1.6% [-1.9%, -1.3%] | 6.4% | -4.1% (284) | no |
| Argentina Liga Profesional | 1x2 | elo | best_closing | 2761 | 3.0% [-5.2%, 10.9%] | 1.2% [-1.9%, 9.2%] | – | 11.0% (523) | no |
| Switzerland Super League | 1x2 | model | best_closing | 1109 | -3.3% [-14.0%, 8.3%] | 0.7% [-1.9%, 5.2%] | – | 8.7% (213) | no |
| France Ligue 1 | 1x2 | elo | best_early | 1692 | -9.9% [-17.2%, -2.7%] | -1.5% [-2.0%, -0.9%] | 7.3% | -4.6% (243) | no |
| China Super League | 1x2 | elo | best_closing | 1160 | -7.4% [-17.2%, 2.5%] | -1.3% [-2.0%, -0.6%] | – | -3.8% (245) | no |
| England Premier League | ou25 | model | best_early | 1538 | -2.8% [-9.0%, 3.0%] | -1.6% [-2.0%, -1.2%] | 30.8% | -1.8% (252) | no |
