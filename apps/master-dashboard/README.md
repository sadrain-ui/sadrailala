# 🎯 Legion Master Control Center

**Unified Dashboard** - All-in-one control panel for Legion Engine

## 🚀 Features

### Dashboard Pages:
- 📊 **Dashboard** - Overview & system status
- 💰 **Trading** - Markets & trading interface
- 💼 **Portfolio** - Asset management
- 🎯 **Campaigns** - Campaign management
- 🔐 **Admin Panel** - System administration
- 🔍 **Diagnostics** - System health checks
- 🚀 **Legion Tool** - Cloning tool monitoring (real-time metrics, extraction logs)
- 📈 **Monitoring** - Infrastructure metrics
- ⚙️ **Configuration** - System settings
- 🔔 **Alerts** - Notifications & alerts
- 👤 **Profile** - User settings

## 🛠️ Setup

### Installation

```bash
cd apps/master-dashboard
npm install
```

### Development

```bash
npm run dev
```

Open [http://localhost:4000](http://localhost:4000)

### Build

```bash
npm run build
```

## 🔐 Authentication

Default credentials:
- Email: `admin@legion.com`
- Password: `password`

## 📊 Legion Tool Monitoring

The **Legion Tool** page displays:
- **Live Metrics**: Active platforms, QPS, extracted data
- **Cookie Rotation**: Session pool health, rotation status
- **Platform Statistics**: Per-platform accuracy & status
- **Real-time Logs**: Extraction logs with timestamps
- **Deployment Status**: Docker containers, backend integration

## 🏗️ Architecture

```
apps/master-dashboard/
├── src/
│   ├── pages/          # Page components
│   ├── components/     # Reusable components
│   ├── store/         # Zustand stores
│   ├── api/           # API integration
│   ├── App.tsx        # Main app
│   ├── main.tsx       # Entry point
│   └── index.css      # Styles
├── public/            # Static files
└── index.html         # HTML entry
```

## 🎨 Design

- **Dark Theme** - Gray-900/950 backgrounds
- **Tailwind CSS** - Utility-first styling
- **Lucide Icons** - Icon library
- **Recharts** - Charts & graphs

## 📦 Dependencies

- React 18
- React Router 6
- Zustand (State management)
- Axios (HTTP client)
- Recharts (Charting)
- Lucide React (Icons)
- Tailwind CSS (Styling)

## 🚀 Deployment

### Docker

```bash
docker build -t legion-dashboard .
docker run -p 4000:4000 legion-dashboard
```

### Environment Variables

```env
VITE_API_URL=http://localhost:3000
VITE_BACKEND_URL=http://sadrailala-production.up.railway.app
```

## 📝 Notes

- Single unified dashboard combining all tools
- Real-time monitoring for Legion cloning tool
- Responsive design (mobile-friendly)
- Production-ready code

## 🔄 Real-time Updates

WebSocket integration for:
- Live metrics updates
- Real-time extraction logs
- System status monitoring
- Alert notifications

## 👥 Role-based Access

- **Admin**: Full access to all features
- **User**: Read/write on assigned sections
- **Viewer**: Read-only access

---

**Port**: 4000
**Status**: Active & Production Ready ✅
