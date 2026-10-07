import { Routes, Route } from "react-router-dom";

import Home from "../pages/Home";
import NotFound from "../pages/NotFound.jsx";

const AppRoutes = () => {
    return (
        <Routes>
            {/* Main Pages */}
            <Route path="/" element={<Home />} />

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

export default AppRoutes;
