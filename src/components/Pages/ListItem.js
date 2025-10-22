import React, { useState } from "react";
import "./ListItem.css";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import useAuthStore from "../../stores/authStore";
import { FiExternalLink, FiCheckCircle, FiLoader } from "react-icons/fi";

const ListItem = ({ page }) => {
  const user = useAuthStore((state) => state.user);
  const [monetizationType, setMonetizationType] = useState(
    page?.monetizationType || "video_insights"
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="list-item">
      <div className="list-item-content">
        <div className="page-avatar">
          <img
            src={page.picture}
            alt={`${page.name} logo`}
            onClick={() => window.open(page.link, "_blank")}
          />
        </div>

        <div className="page-info">
          <div className="page-name">
            <a
              href={page.link}
              target="_blank"
              rel="noopener noreferrer"
              className="page-link"
            >
              {page.name}
              <FiExternalLink className="external-icon" />
            </a>
          </div>
          <div className="page-id">ID: {page.id}</div>
        </div>
      </div>
    </div>
  );
};

export default ListItem;