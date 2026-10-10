// import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";

import AppRoutes from "./routes/AppRoutes.jsx";
import CookieConsentBanner from './components/CookieConsentBanner.jsx';
// import IntroLoader from "./components/layout/IntroLoader.jsx";
// import SeoManager from "./seo/SeoManager.jsx";

// function ScrollToTop() {
//   const { pathname } = useLocation();

//   useEffect(() => {
//     window.scrollTo(0, 0);
//   }, [pathname]);

//   return null;
// }

function App() {
  return (
    <BrowserRouter>
      {/* <IntroLoader /> */}
      <div className="app">

        <main>
          <AppRoutes />
        </main>
        <CookieConsentBanner />

      </div>
    </BrowserRouter>
  );
}

export default App;
