import { getGlobalSettingsService, updateGlobalSettingsService } from "./globalSetting.service.js";

export const getGlobalSettings = async (req, res, next) => {
  try {
    const settings = await getGlobalSettingsService();
    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
};

export const updateGlobalSettings = async (req, res, next) => {
  try {
    const settings = await updateGlobalSettingsService(req.body);
    res.json({ success: true, message: "Global settings updated successfully", settings });
  } catch (err) {
    next(err);
  }
};
