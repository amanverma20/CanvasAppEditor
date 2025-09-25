# Stateless 2D Editor

A collaborative real-time 2D drawing editor built with React, Fabric.js, and Firebase. Create, edit, and share interactive canvases with real-time synchronization across multiple users.

**🌐 Live Demo:** [https://task-manager-32b4c.web.app](https://task-manager-32b4c.web.app)

## 🚀 Features

- **Real-time Collaboration**: Multiple users can edit the same canvas simultaneously
- **Drawing Tools**: Add rectangles, circles, text, and freehand drawing
- **Canvas Manipulation**: Move, resize, and modify objects on the canvas
- **Persistent Storage**: Canvases are automatically saved to Firebase Firestore
- **Shareable Links**: Each canvas has a unique URL that can be shared
- **View-Only Mode**: Share canvases in read-only mode using `?viewOnly=true`
- **Responsive Design**: Works on desktop and mobile devices

## 🛠️ Tech Stack

- **Frontend**: React 19.1.1 with JSX
- **Canvas Library**: Fabric.js 6.7.1 for advanced canvas manipulation
- **Backend**: Firebase 12.3.0 (Firestore for real-time database)
- **Routing**: React Router DOM 7.9.2
- **Build Tool**: Vite 7.1.7
- **Styling**: CSS with modern features

## 📦 Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd stateless-2d-editor
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up Firebase:
   - Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
   - Enable Firestore Database
   - Add your Firebase configuration to `src/firebase.js`

4. Start the development server:

   ```bash
   npm run dev
   ```

## 🎮 Usage

### Creating a New Canvas

- Visit the root URL (`/`) to automatically create a new canvas
- You'll be redirected to `/canvas/{unique-id}` where you can start drawing

### Drawing Tools

- **Rectangle**: Click the rectangle button to add rectangular shapes
- **Circle**: Click the circle button to add circular shapes  
- **Text**: Click the text button to add editable text elements
- **Pen Tool**: Toggle drawing mode for freehand sketching
- **Selection**: Click and drag to select and modify existing objects

### Sharing Canvases

- **Collaborative**: Share the canvas URL directly for real-time collaboration
- **View-Only**: Add `?viewOnly=true` to the URL for read-only access
- **Example**: `https://yourapp.com/canvas/abc123?viewOnly=true`

### Keyboard Shortcuts

- **Delete/Backspace**: Remove selected objects
- **Escape**: Deselect all objects

## 🏗️ Project Structure

```text
src/
├── components/          # Reusable React components
├── hooks/              
│   └── useFabric.js    # Custom hook for Fabric.js canvas management
├── pages/
│   └── CanvasPage.jsx  # Main canvas page component
├── App.jsx             # Main application component with routing
├── firebase.js         # Firebase configuration and initialization
├── main.jsx           # Application entry point
└── index.css          # Global styles
```

## 🔧 Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## 🌐 Firebase Configuration

Create a `src/firebase.js` file with your Firebase configuration:

```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  // Your Firebase configuration
  apiKey: "your-api-key",
  authDomain: "your-auth-domain",
  projectId: "your-project-id",
  storageBucket: "your-storage-bucket",
  messagingSenderId: "your-messaging-sender-id",
  appId: "your-app-id"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
```

## 🔧 Firebase Configuration Files

The project includes these Firebase configuration files:

- `firebase.json`: Firebase Hosting configuration with build directory and routing rules
- `.firebaserc`: Project aliases and default project settings

These files are automatically created when you run `firebase init hosting`.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🔍 Troubleshooting

### Common Issues

**Canvas objects disappear immediately after creation:**

- Ensure Firebase is properly configured
- Check browser console for JavaScript errors
- Verify Firestore rules allow read/write access

**Real-time sync not working:**

- Check internet connection
- Verify Firebase project is active
- Ensure Firestore rules are properly configured

**Build errors:**

- Make sure all dependencies are installed (`npm install`)
- Check Node.js version compatibility (requires Node.js 20.19+ or 22.12+)

## 🚀 Deployment

The project can be deployed to Firebase Hosting or other static hosting services:

### Firebase Hosting (Recommended)

1. **Install Firebase CLI** (if not already installed):

   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:

   ```bash
   firebase login
   ```

3. **Build the project**:

   ```bash
   npm run build
   ```

4. **Deploy to Firebase Hosting**:

   ```bash
   firebase deploy
   ```

Your app will be available at: `https://your-project-id.web.app`

### Other Hosting Options

- **Vercel**: `npm run build` then deploy the `dist` folder
- **Netlify**: Connect your repository and set build command to `npm run build`

## 📞 Support

For support, please open an issue in the GitHub repository or contact the maintainers.
