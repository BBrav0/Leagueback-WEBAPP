# Leagueback

> Quantify your personal impact in every League of Legends match.

Leagueback crunches in-game statistics to tell you—clearly and objectively—whether you carried, inted, or did everything humanly possible. Stop staring at raw KDA; start understanding your real contribution.

## How It Works

In Solo Queue roughly **40% of matches** are effectively predetermined, while only **20%** hinge on your individual performance. Leagueback analyses each game and classifies it into one of four outcomes:

| Outcome          | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| Impact Win       | Your play tipped the scales and secured the victory.        |
| Guaranteed Win   | Your team would have won with or without you.               |
| Impact Loss      | Your mistakes directly cost your team the game.            |
| Guaranteed Loss  | Even Faker couldn't have saved this one.                    |

The app surfaces these insights through clean charts and dashboards so you can focus your practice where it matters most.

## Features

- 📊 **Performance dashboard** contrasting you vs. team averages
- 💾 **Local match cache** for ultra-fast history look-ups
- 🥧 **Pie chart** summarising total impact wins & losses
- 🛠️ **Settings panel**: clear cache

## Coming Soon

- ⚡ **Real-time impact score** updated during the match
- 🗺️ **Objective, turret, and lane weighting** for an even smarter algorithm
- 🖼️ **Rank icons, scoreboard, and additional UI polish**
- 📈 **Algorithm smoothing** for fairer score curves

## Installation

### Prerequisites

- Node.js 18+ and npm (or your preferred package manager)

### Setup

```bash
# Clone the repository
git clone https://github.com/BBrav0/Leagueback-WEBAPP.git
cd Leagueback-WEBAPP

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Supabase credentials and Riot Proxy URL

# Run the development server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Build for Production

```bash
# Build the application
npm run build

# Start the production server
npm start
```

## Architecture

This web application consists of:

- **Frontend**: Next.js 16 with React, TypeScript, and Tailwind CSS
- **API Proxy**: Cloudflare Worker for secure Riot API access
- **Database**: Supabase for caching match data and impact categories

## Contributing

Pull requests are welcome! Feel free to open an issue for feature requests, bug reports, or general discussion.

## Disclaimer

Leagueback isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. All in-game content, imagery, and names are registered trademarks of Riot Games, Inc.
