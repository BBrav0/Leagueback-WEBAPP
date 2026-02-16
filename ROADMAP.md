# Leagueback Roadmap

## Current Status (v0.3)

### ✅ Implemented Features

- **Performance Dashboard**: Real-time impact analysis comparing player vs team averages
- **Match History Analysis**: Load and analyze ranked matches with incremental loading
- **Impact Classification**: Categorize matches into Impact Wins, Guaranteed Wins, Impact Losses, and Guaranteed Losses
- **Performance Timeline Charts**: Visualize impact scores throughout each match
- **Pie Chart Visualization**: Impact overview showing distribution of match outcomes
- **Lifetime Statistics**: Track cumulative impact across all analyzed matches
- **Local Match Cache**: Browser-based caching for fast match lookups
- **Rate Limiting**: Client-side rate limiting to prevent API exhaustion
- **Incremental Loading**: Load More button to fetch additional matches without overwhelming the API
- **Database Storage**: Supabase integration for persistent match data storage

---

## Phase 1: Core Algorithm Improvements (Q1 2025)

### Algorithm Enhancements

- **Objective & Turret Weighting**: Incorporate objective control (dragons, barons, towers) into impact calculations
- **Lane-Specific Weighting**: Adjust impact scores based on role (top, jungle, mid, ADC, support)
- **Vision Score Integration**: Better weighting for vision score differences, especially for support and jungle roles
- **CS Difference Analysis**: Factor in CS differentials relative to role expectations
- **Algorithm Smoothing**: Implement fairer score curves to reduce edge case anomalies
- **Remake Detection**: Automatically exclude remakes from match history analysis

### Data Accuracy

- **Rank Display**: Show actual rank icons and tier information for each match
- **Match Scoreboard**: Display full team compositions and stats
- **Champion Icons**: Add champion images to match cards
- **Match Date/Time**: Show when each match was played

---

## Phase 2: Advanced Analytics (Q2 2025)

### Historical Analysis

- **Per-Season Analytics**: Filter and analyze matches by ranked season
- **Date Range Filtering**: Select specific date ranges for analysis
- **Trend Analysis**: Track improvement over time with trend lines
- **Peak Performance Periods**: Identify when you performed best
- **Role Performance Comparison**: Compare impact across different roles played

### Enhanced Visualizations

- **Per-Season Pie Charts**: Separate impact breakdowns for each ranked season
- **Per-Date Range Charts**: Analyze performance during specific time periods
- **Heatmaps**: Visualize performance patterns by day of week, time of day
- **Win Streak Analysis**: Identify and visualize winning/losing streaks
- **Champion Performance**: Track impact scores by champion played

### Export & Sharing

- **Match History Export**: Download match data as CSV/JSON
- **Shareable Reports**: Generate shareable links for performance summaries
- **Screenshot Generation**: Create shareable images of performance charts

---

## Phase 3: User Accounts & Personalization (Q3 2025)

### Authentication

- **User Sign-In**: OAuth integration (Google, Discord, Riot account)
- **User Profiles**: Save multiple summoner accounts per user
- **Account Switching**: Quick switch between multiple accounts
- **Privacy Controls**: Control what data is stored and shared

### Personalization

- **Customizable Dashboard**: Rearrange and customize dashboard layout
- **Favorite Champions**: Quick filter by favorite champions
- **Custom Tags**: Tag matches with custom labels (e.g., "tilted", "smurfing", "learning")
- **Notes System**: Add personal notes to matches for review
- **Performance Goals**: Set and track personal improvement goals

### Data Management

- **Cloud Sync**: Sync match data across devices
- **Match History Backup**: Export and restore match history
- **Bulk Operations**: Clear or export multiple matches at once
- **Data Retention Settings**: Configure how long to keep match data

---

## Phase 4: Real-Time Features (Q4 2025)

### Live Match Tracking

- **Real-Time Impact Score**: Track impact score during active matches (requires Riot API live match endpoint)
- **Live Match Dashboard**: Real-time performance metrics during game
- **Post-Game Analysis**: Instant analysis when match ends
- **Match Prediction**: Predict match outcome based on early game performance

### Notifications

- **Match Completion Alerts**: Notify when new matches are available for analysis
- **Performance Milestones**: Celebrate reaching impact score thresholds
- **Weekly Summary**: Email/discord summary of weekly performance

---

## Phase 5: Social & Competitive Features (2026)

### Social Features

- **Friend Comparisons**: Compare your impact scores with friends
- **Leaderboards**: Rank players by impact score (opt-in)
- **Team Analysis**: Analyze performance when playing with specific teammates
- **Community Challenges**: Participate in community-wide performance challenges

### Advanced Statistics

- **Meta Analysis**: Track performance against current meta champions
- **Matchup Analysis**: How you perform against specific champions
- **Team Composition Impact**: Analyze how team comps affect your performance
- **Clutch Performance**: Identify your performance in close games vs stomps

---

## Technical Improvements

### Performance

- **Optimistic UI Updates**: Instant feedback while data loads
- **Background Sync**: Automatically fetch new matches in background
- **Progressive Web App**: PWA support for mobile installation
- **Offline Mode**: View cached matches without internet connection

### Infrastructure

- **API Rate Limit Optimization**: Better batching and caching strategies
- **Database Indexing**: Optimize queries for faster match retrieval
- **CDN Integration**: Faster asset delivery globally
- **Monitoring & Analytics**: Track app performance and user behavior

### Developer Experience

- **API Documentation**: Comprehensive API docs for contributors
- **Testing Suite**: Unit and integration tests
- **CI/CD Pipeline**: Automated testing and deployment
- **Error Tracking**: Better error reporting and debugging tools

---

## Future Considerations

- **Mobile App**: Native iOS/Android applications
- **Desktop App**: Electron-based desktop application
- **Browser Extension**: Quick access from browser
- **API Access**: Public API for developers
- **Machine Learning**: ML-based impact prediction and analysis
- **Coaching Features**: AI-powered coaching recommendations
- **Replay Integration**: Link to match replays for detailed review

---

## Notes

- Priorities may shift based on user feedback
- Some features may require Riot API access or partnerships
- Timeline estimates are approximate and subject to change
- Community feedback is welcome - open an issue to suggest features!
