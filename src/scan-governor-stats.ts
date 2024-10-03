import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { PrismaClient } from "@prisma/client";
import type { Device } from "adb-ts";
import clipboard from "clipboardy";
import sharp from "sharp";
import { OEM, PSM, createWorker } from "tesseract.js";
import { findCutoutPosition } from "./util/find-cutout-position.js";
import { updateGovernorDKP, upsertGovernorDKP, deleteGovernors } from "./util/governor-dkp.js";
import { rebootRoK } from "./util/reboot-rok.js";

const ELEMENT_POSITIONS = {
  GOVERNOR_PROFILE_BUTTON: "60 50",
  GOVERNOR_PROFILE_PREVIEW_X_COORDINATE: 690,
  RANKINGS_BUTTON: "510 746",
  INDIVIDUAL_POWER_BUTTON: "424 505",
  GOVERNOR_PROFILE_PREVIEW_Y_CLICK_COORDINATES: [285, 390, 490, 590, 605],
  POWER_LABEL: {
    left: 884,
    top: 332,
    width: 180,
    height: 44,
  },
  KILL_POINTS_LABEL: {
    left: 1134,
    top: 331,
    width: 222,
    height: 44,
  },
  GOVERNOR_ID_LABEL: {
    left: 733,
    top: 197,
    width: 200,
    height: 35,
  },
  KILL_TIER_LABELS: {
    left: 861,
    top: 426,
    width: 129,
    height: 219,
  },
  MORE_INFO_LABELS: {
    left: 1126,
    top: 254,
    width: 181,
    height: 527,
  },
  MORE_INFO_CLOSE_BUTTON: "1396 58",
  GOVERNOR_PROFILE_CLOSE_BUTTON: "1365 104",
  CLOSE_KILL_RANKINGS_BUTTON: "1395 55",
  KILL_RANKINGS_BUTTON: "825 525",
} as const;

const ANIMATION_DURATION = 750;

const RESOURCE_ROOT_PATH = join(process.cwd(), "resources", "stats-scan");
const TEMP_ROOT_PATH = join(process.cwd(), "temp");

export const scanGovernorStats = async (
  device: Device,
  top: number,
  prisma: PrismaClient,
  newKvK: boolean,
  resetPower: boolean,
  resetKp: boolean,
) => {
  await rebootRoK(device);

  console.log("Deleting old data")
  await deleteGovernors(prisma)

  // Open governor profile
  console.log("Clicking governor profile:" + ELEMENT_POSITIONS.GOVERNOR_PROFILE_BUTTON)
  await device.shell(`input tap ${ELEMENT_POSITIONS.GOVERNOR_PROFILE_BUTTON}`);

  await setTimeout(ANIMATION_DURATION);

  // Open RANKINGS_BUTTON Rankings
  console.log("Clicking RANKINGS_BUTTON:" + ELEMENT_POSITIONS.RANKINGS_BUTTON)
  await device.shell(`input tap ${ELEMENT_POSITIONS.RANKINGS_BUTTON}`);

  await setTimeout(ANIMATION_DURATION);

  // Open individual power rankings
  console.log("Clicking INDIVIDUAL_POWER_BUTTON:" + ELEMENT_POSITIONS.INDIVIDUAL_POWER_BUTTON)
  await device.shell(`input tap ${ELEMENT_POSITIONS.INDIVIDUAL_POWER_BUTTON}`);

  await setTimeout(ANIMATION_DURATION);

  const worker = await createWorker();

  await worker.loadLanguage("eng");
  await worker.initialize("eng");

  await worker.setParameters({
    tessedit_ocr_engine_mode: "4" as unknown as OEM,
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  });

  let fails = 0;

  for (let i = 0; i < top; i++) {
    if (fails > 250) {
      throw new Error("Failed to open governor profile over 250 times.");
    }

    const NEXT_CLICK_POS = i > 4 ? 4 : i;

    // Open governor profile
    console.log("Clicking Governor Profile:" + ELEMENT_POSITIONS.GOVERNOR_PROFILE_PREVIEW_X_COORDINATE + " " + ELEMENT_POSITIONS.GOVERNOR_PROFILE_PREVIEW_Y_CLICK_COORDINATES[NEXT_CLICK_POS])
    await device.shell(
      `input tap ${ELEMENT_POSITIONS.GOVERNOR_PROFILE_PREVIEW_X_COORDINATE} ${ELEMENT_POSITIONS.GOVERNOR_PROFILE_PREVIEW_Y_CLICK_COORDINATES[NEXT_CLICK_POS]}`,
    );

    await setTimeout(ANIMATION_DURATION);

    await writeFile(
      join(TEMP_ROOT_PATH, "governor-profile.jpg"),
      await device.screenshot(),
    );

    //const moreInfoButtonCoordinates = await findCutoutPosition(
      //join(TEMP_ROOT_PATH, "governor-profile.jpg"),
      //join(RESOURCE_ROOT_PATH, "more-info-button.jpg"),
    //);

    const moreInfoButtonCoordinates = {
      x: 356,
      y: 736
    };

    console.log("moreInfoButtonCoordinates:" + moreInfoButtonCoordinates.x + " " + moreInfoButtonCoordinates.y);

    if (!moreInfoButtonCoordinates) {
      fails++;

      // Swipe to next governor profile
      await device.shell("input swipe 690 605 690 540");

      await setTimeout(ANIMATION_DURATION);

      continue;
    }

    await clipboard.write("");

    const copyNicknameButtonCoordinates = await findCutoutPosition(
      join(TEMP_ROOT_PATH, "governor-profile.jpg"),
      join(RESOURCE_ROOT_PATH, "copy-nickname-button.jpg"),
    );

    if (!copyNicknameButtonCoordinates) {
      console.log("Failed to get copyNicknameButtonCoordinates the first time, sleeping for this many milliseconds: " + ANIMATION_DURATION * 3);
      await setTimeout(ANIMATION_DURATION * 3);
      console.log("Done Sleeping");
      const copyNicknameButtonCoordinates = await findCutoutPosition(
        join(TEMP_ROOT_PATH, "governor-profile.jpg"),
        join(RESOURCE_ROOT_PATH, "copy-nickname-button.jpg"),
      );
    }

    if (!copyNicknameButtonCoordinates) {
      console.log("Coudlnt get governor profile even after sleeping, skipping to next");
      await device.shell("input swipe 690 605 690 540");
      await setTimeout(ANIMATION_DURATION);
      continue;
    }
    
    console.log("About to try to log copyNicknameButtonCoordinates");
    console.log("copyNicknameButtonCoordinates:" + copyNicknameButtonCoordinates.x + " " + copyNicknameButtonCoordinates.y);

    // Copy nickname
    await device.shell(
      `input tap ${copyNicknameButtonCoordinates.x} ${copyNicknameButtonCoordinates.y}`,
    );

    await setTimeout(ANIMATION_DURATION);

    const nickname = await clipboard.read();
    console.log("nickname: " + nickname);

    const governorProfileToBW = await sharp(
      join(TEMP_ROOT_PATH, "governor-profile.jpg"),
    )
      .threshold(210)
      .blur(0.75)
      .toBuffer();

    const {
      data: { text: power },
    } = await worker.recognize(governorProfileToBW, {
      rectangle: ELEMENT_POSITIONS.POWER_LABEL,
    });

    const {
      data: { text: killPoints },
    } = await worker.recognize(governorProfileToBW, {
      rectangle: ELEMENT_POSITIONS.KILL_POINTS_LABEL,
    });

    const governorProfileToGrayScale = await sharp(
      join(TEMP_ROOT_PATH, "governor-profile.jpg"),
    )
      .grayscale()
      .toBuffer();

    const {
      data: { text: governorID },
    } = await worker.recognize(governorProfileToGrayScale, {
      rectangle: ELEMENT_POSITIONS.GOVERNOR_ID_LABEL,
    });

    const killStatisticsButtonCoordinates = await findCutoutPosition(
      join(TEMP_ROOT_PATH, "governor-profile.jpg"),
      join(RESOURCE_ROOT_PATH, "kill-statistics-button.jpg"),
    );

    if (!killStatisticsButtonCoordinates) {
      throw new Error(
        "Could not locate coordinates for opening kill statistics.",
      );
    }

    // Open kill statistics
    console.log("Clicking Open kill statistics: " + killStatisticsButtonCoordinates.x + " " + killStatisticsButtonCoordinates.y)
    await device.shell(
      `input tap ${killStatisticsButtonCoordinates.x} ${killStatisticsButtonCoordinates.y}`,
    );

    await setTimeout(ANIMATION_DURATION);

    const killStatisticsToBW = await sharp(await device.screenshot())
      .threshold(210)
      .blur(0.75)
      .toBuffer();

    await worker.setParameters({
      tessedit_ocr_engine_mode: "4" as unknown as OEM,
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });

    const {
      data: { text: kills },
    } = await worker.recognize(killStatisticsToBW, {
      rectangle: ELEMENT_POSITIONS.KILL_TIER_LABELS,
    });

    const tierKills = Object.fromEntries(
      kills
        .split("\n")
        .filter(Boolean)
        .map((kills, index) => [`tier${index + 1}kp`, kills]),
    ) as Record<`tier${1 | 2 | 3 | 4 | 5}kp`, string>;

    console.log("tierKills:" + tierKills);

    // Open More Info
    const BUTTON_CLICK_AREA_OFFSET = 0;

    console.log("Clicking more info: " + moreInfoButtonCoordinates.x + " " + moreInfoButtonCoordinates.y)
    await device.shell(
      `input tap ${moreInfoButtonCoordinates.x + BUTTON_CLICK_AREA_OFFSET} ${
        moreInfoButtonCoordinates.y + BUTTON_CLICK_AREA_OFFSET
      }`,
    );

    await setTimeout(ANIMATION_DURATION);

    const moreInfoStatsToGrayscale = await sharp(await device.screenshot())
      .grayscale()
      .jpeg()
      .toBuffer();

    const {
      data: { text: moreInfoStats },
    } = await worker.recognize(moreInfoStatsToGrayscale, {
      rectangle: ELEMENT_POSITIONS.MORE_INFO_LABELS,
    });

    const statsValues = moreInfoStats.split("\n").filter(Boolean);
    console.log("statsValues" + statsValues);

    const dead = statsValues.at(3);
    const resourceAssistance = statsValues.at(6);
    console.log("dead" + dead);
    console.log("resourceAssistance" + resourceAssistance);

    // Close More Info
    console.log("Clicking close more info: " + ELEMENT_POSITIONS.MORE_INFO_CLOSE_BUTTON)
    await device.shell(`input tap ${ELEMENT_POSITIONS.MORE_INFO_CLOSE_BUTTON}`);

    await setTimeout(ANIMATION_DURATION);

    // Close Governor Profile
    console.log("Clicking close governor profile: " + ELEMENT_POSITIONS.GOVERNOR_PROFILE_CLOSE_BUTTON)
    await device.shell(
      `input tap ${ELEMENT_POSITIONS.GOVERNOR_PROFILE_CLOSE_BUTTON}`,
    );

    await setTimeout(ANIMATION_DURATION);

    console.log("nickname: " + nickname);
    console.log("power: " + power);
    console.log("killPoints: " + killPoints);
    console.log("governorID: " + governorID);
    console.log("dead: " + dead);
    console.log("resourceAssistance: " + resourceAssistance);
    console.log("tierKills.tier1kp: " + tierKills.tier1kp);
    console.log("tierKills.tier2kp: " + tierKills.tier2kp);
    console.log("tierKills.tier3kp: " + tierKills.tier3kp);
    console.log("tierKills.tier4kp: " + tierKills.tier4kp);
    console.log("tierKills.tier5kp: " + tierKills.tier5kp);

    if (
      !nickname ||
      !power ||
      !killPoints ||
      !governorID ||
      !dead ||
      !resourceAssistance ||
      Object.values(tierKills).some((tierKills) => !tierKills)
    ) {
      console.log("Hitting a continue abc");
      continue;
    }

    const governor = {
      nickname,
      power: power.trim(),
      kp: killPoints.trim(),
      id: governorID.trim(),
      ...tierKills,
      dead,
      resourceAssistance,
    };

    if (!newKvK) {
      await updateGovernorDKP(prisma, governor);
    } else {
      await upsertGovernorDKP(prisma, governor, resetPower, resetKp);
    }
  }

  // Close individual kill rankings
  console.log("Clicking Close individual kill rankings: " + ELEMENT_POSITIONS.CLOSE_KILL_RANKINGS_BUTTON)
  await device.shell(
    `input tap ${ELEMENT_POSITIONS.CLOSE_KILL_RANKINGS_BUTTON}`,
  );

  await setTimeout(ANIMATION_DURATION);

  // Open individual kill rankings
  console.log("Clicking Open individual kill rankings: " + ELEMENT_POSITIONS.KILL_RANKINGS_BUTTON)
  await device.shell(`input tap ${ELEMENT_POSITIONS.KILL_RANKINGS_BUTTON}`);

  await worker.terminate();
};
