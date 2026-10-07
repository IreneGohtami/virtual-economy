# Virtual Economy

A game where every players starts equal with a fixed amount of money and each person will choose a specialty where they earn a small bonus for every manufacturing in that specialty. Like tycoon-online, but let’s revamp this to a more modern version and focusing on South-East Asia for the source of popular demand & supply chain.

### Level 0 Commodity

| Category | Examples | Requirements / economic personalities | Land (per tile) | Setup cost | Economic role |
| --- | --- | --- | --- | --- | --- |
| Agricultural | Rice, palm fruit, coconut, coffee | Massive land | 9 (3x3) | 300 | High volume / stable |
| Energy | Crude oil, natural gas | High capital | 6 (3x2) | 500 | High demand / strategic |
| Metal | Nickel, Iron | High capital + limited resources | 4 (2x2) | 500 | Scarce / high risk |
| Livestock & Fisheries | Poultry (chicken), cattle (cow), fish | Balanced; fishery need to be near water terrain | 6 (3x2) | 400 | Food / moderate |
| Forestry | Timber, rubber | Massive land | 9 (3x3) | 300 | Slow / long-term |

Each season / round starts and ends at the same time; duration per round should be configurable (start with 30 days for beta). Every player will start with 1,000 coins where they can use it to purchase land & hire workers to start farming their natural resources.

- Bonus specialty = 10% on production yield.
- Land price = 25 / tile for first 10 tiles; land price per tile will increase by 5 per every 10 tiles obtained. So for land 20-30, price is 30 / tile, and for land 31-40, price is 35 / tile and so on.
- Each player gets 500 storage space by default.
- Storage upgrade:


    | Storage | Cost |
    | --- | --- |
    | **500** | Free |
    | 750 | 100 |
    | 1,000 | 175 |
    | 1,500 | 300 |
    | 2,000 | 500 |
    | 3,000 | 800 |
    | 5,000 | 1,500 |

Design a map based on SEA region, pixel-based, modern and simple. One pixel represent a tile that a player can lock-in to buy, following the layout that each category requires. Use different color to show different terrain, like water, mountain, fertile soil, etc. Map should be randomly generated each round but with consistent % of water square, etc. that’s inspired from SEA region.

#### Base Price

- Actual Price = Base Price × Demand Multiplier × Supply Multiplier (multiplier only takes effect after first 7 days). Once the multiplier are in effect, prices will only be calibrated once per day at midnight GMT+8.
- Operational Cost = Each worker costs from 6-10 coins / day. Max 2 workers per factory, each additional worker increases 25% yield (before any labor specialty bonus).
- Agriculture


    | Commodity | Time | Yield | Base Price | Gross / Day |
    | --- | --- | --- | --- | --- |
    | **Rice** | 4h | 12 | 3 | 36 / 216 |
    | **Palm Fruit** | 6h | 10 | 4 | 40 / 160 |
    | **Cocoa** | 8h | 8 | 7 | 56 / 168 |
    | **Coffee** | 12h | 6 | 8 | 48 / 96 |
- Energy


    | Commodity | Time | Yield | Base Price | Gross / Day |
    | --- | --- | --- | --- | --- |
    | Crude Oil | 8h | 8 | 9 | 72 / 216 |
    | Natural Gas | 10h | 7 | 10 | 70 / 168 |
- Metal


    | Commodity | Time | Yield | Base Price | Gross / Day |
    | --- | --- | --- | --- | --- |
    | Iron Ore | 10h | 10 | 7 | 70 / 168 |
    | Nickel Ore | 18h | 6 | 18 | 108 / 144 |
- Livestock & Fisheries


    | Commodity | Time | Yield | Base Price | Gross / Day |
    | --- | --- | --- | --- | --- |
    | Cattle | 16h | 5 | 14 | 70 / 105 |
    | Poultry | 6h | 15 | 4 | 60 / 240 |
    | Fishery | 8h | 12 | 5 | 60 / 180 |
- Forestry


    | Commodity | Time | Yield | Base Price | Gross / Day |
    | --- | --- | --- | --- | --- |
    | Timber | 24h | 10 | 10 | 100 / 100 |
    | Rubber | 18h | 8 | 12 | 96 / 128 |

#### Bank

In case each player needs additional coins, they can loan money to fast track their manufacturing. Installment plan is every 5 days where interest is X%. Based on each player’s net worth, they can only loan a maximum of X coins.

- Net Worth = Cash + Land Value + Factory Value + Inventory Market Value - Outstanding Loan


    | Parameter | Recommendation |
    | --- | --- |
    | Minimum loan | **100 coins** |
    | Maximum loan | **50% of net worth** |
    | Interest | **5% per 5 days** |
    | Repayment | Every **5 days** |
    | Loan duration | **Maximum 12 days** |
    | Early repayment | Allowed |
    | Late payment | Penalty / restricted borrowing |

#### Marketplace

This is the global trading center where player can sell their inventory for other players to buy based on current market price. If a player needs cash immediately and did not want to wait for other player to purchase, he can sell it to the bank who will buy the goods for 10% less of the market rate (instant sell). For now, players cannot set their own market price. Goods have to follow global market price fluctuations. When a player moves their inventory to the marketplace, the items will follow a queue system FIFO. So if player A wants to sell 500 timbers, then later player B also wants to sell 300 timbers, the market will sell player A’s stock first before player B’s. Players can view what items are available in the market, along with the price & quantity.

#### Workers

The game will maintain a set of defined workers, let’s say 2000 profiles to begin, but only a certain amount is unlocked based on how many players or commodity are unlocked. A workers’ profile table will be maintained that shows their name, age, gender, specialty, salary, experience level (1-5), and commitment level (70%-100%), all randomly generated before the game starts. Each hired worker will affect production to a certain degree. Example if a player hires ‘Roger Federer’ who is a skilled (level 5) farmer, then this worker will increase yield by 5% in any agriculture factory. A low commitment level may generate random event like sickness or absent from work which will halt or slow production.

### Level 1 & 2 Commodity + Final Consumer

| Category | Level 0 | Level 1 option(s) | Level 2 / Finished Good | Final Business / Consumer |
| --- | --- | --- | --- | --- |
| 🌾 Agriculture | **Rice** | Rice → **Flour** | — | 🛒 **Supermarket** |
|  | **Palm Fruit** | Palm → **Biodiesel** | — | ⛽ **Petrol Station** |
|  |  | Palm → **Cooking Oil** | — | 🛒 **Supermarket** |
|  | **Coffee Beans** | Coffee → **Roasted Coffee** | — | ☕ **Cafe** |
|  | **Cocoa Beans** | Cocoa → **Chocolate** | — | 🛒 **Supermarket** |
| ⚡ Energy | **Crude Oil** | Oil → **Gasoline** | — | ⛽ **Petrol Station** |
|  |  | Oil → **Plastic** | 1 Plastic + 1 Battery → **Mobile Phone** | 📱 **Electronics Shop** |
|  | **Natural Gas** | Gas → **Fertilizer** | — | 🌾 **Agriculture upgrade / consumption** |
| ⛏️ Metal | **Iron Ore** | Iron → **Steel** | 1 Steel + 1 Tire + 1 Battery → **Automobile** | 🚗 **Car Store** |
|  | **Nickel Ore** | Nickel → **Battery** | Combined with other materials → **Mobile Phone** or **Automobile** | 📱 **Electronics Shop / Car store** |
| 🐔 Livestock & Fisheries | **Poultry - Chicken (choose 1 output)** | Chicken → **Meat** | — | 🥩 Butcher |
|  |  | Chicken → **Eggs** | — | 🛒 **Supermarket** |
|  | **Cattle - Cow (choose 1 output)** | Cow → **Beef** | — | 🥩 Butcher |
|  |  | Cow → **Milk** | — | 🛒 **Supermarket** |
|  | **Fish** | — | — | 🥩 Butcher |
| 🌳 Forestry & Plantation | **Timber** | Timber → **Furniture** | — | 🪑 **Furniture Shop** |
|  | **Rubber** | Rubber → **Tires** | Tires + Steel + Battery → **Automobile** | 🚗 **Car Store** |

### Shops

Final supply chain where NPC will consume these types of goods. Shop will auto consume player’s inventory.

> Factories create supply. Marketplaces redistribute supply. Shops create consumer demand. Consumers create money.
>

| Shop | Products | Attributes |
| --- | --- | --- |
| 🛒 **Supermarket** | Rice products, Cooking Oil, Eggs, Milk, Chocolate | Min 2 types of goods need to be stocked for the supermarket to be operational. |
| 🥩 **Butcher** | Chicken, Beef, Fish | Min 1 type of meat to operate |
| ☕ **Cafe** | Roasted Coffee | Niche market, fast track of commodity progression |
| ⛽ **Petrol Station** | Gasoline, Biodiesel | Common, high-demand commodity |
| 🪑 **Furniture Shop** | Furniture | Slow & long-term progression |
| 📱 **Electronics Shop** | Mobile Phone | Luxury commodity |
| 🚗 **Car Store** | Automobile | Ultimate luxury commodity |

### Game Play

1. Round starts - countdown timer begins
2. Login - player enter email / google login
    1. If email already exists, go straight to main page
    2. If new user → create the account
        1. Ask player to customize avatar & display name (alter ego / org name)
        2. Ask player which commodity category (only from level 0) to specialize in for the 10% bonus yield
        3. Setup each player with default settings; ie 1000 coins
3. To start, player must construct his first factory and choose its location. Display the map which contains a few selected countries in SEA.
    1. Player selects a country, map zooms in to selectable pixel or tiles to setup the factory based on required layout.
    2. Each tile costs money, based on game rule. Once a group of tiles have been selected, and player has enough coins to proceed, lock those tiles for that player as their ‘owned land’.
    3. Next, player needs to pay a setup fee based on the commodity selected and the factory will be in placed.
    4. Finally, in order to start production, player needs to hire at least 1 worker and until the worker is hired, the factory will be idle. Player needs to pay worker’s salary.
4. Throughout the game, there will be live announcement that everyone can see to highlight certain events, example: Bank opens (day 1 itself), Global price change (day 8), Worker’s strike (random event), etc.
5. Leaderboards
6. Player’s account stats / dashboard
7. Wealth calculation