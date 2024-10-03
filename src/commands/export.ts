import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import writeXlsxFile from "write-excel-file/node";
import type { CommandExecutionContext } from "../types.js";
import { calculateDkp } from "../util/calculate-dkp.js";

function* chunks<T>(arr: T[], n: number): Generator<T[], void> {
  for (let i = 0; i < arr.length; i += n) {
    yield arr.slice(i, i + n);
  }
}

export const exportCommand = {
  data: new SlashCommandBuilder()
    .setName("export-kvk")
    .setDescription("Export KvK progress to an Excel file")
    .toJSON(),
  execute: async ({ interaction, prisma }: CommandExecutionContext) => {
    await interaction.deferReply();

    const governors = await prisma.governor.findMany({
      orderBy: {
        power: 'desc'
      }
    });

    const HEADER_ROW = [
      {
        value: "Governor ID",
        fontWeight: "bold",
      },
      {
        value: "Nickname",
        fontWeight: "bold",
      },
      {
        value: "Power",
        fontWeight: "bold",
      },
      {
        value: "T1 Kills",
        fontWeight: "bold",
      },
      {
        value: "T2 Kills",
        fontWeight: "bold",
      },
      {
        value: "T3 Kills",
        fontWeight: "bold",
      },
      {
        value: "T4 Kills",
        fontWeight: "bold",
      },
      {
        value: "T5 Kills",
        fontWeight: "bold",
      },
      {
        value: "Deaths",
        fontWeight: "bold",
      },
      {
        value: "RSS Assitance",
        fontWeight: "bold",
      },
    ];

    let dataRows = [];

    for(const item of governors) {
      dataRows.push({"value":item.id});
      dataRows.push({"value":item.nickname});
      dataRows.push({"value":item.power});
      dataRows.push({"value":item.tier1kp});
      dataRows.push({"value":item.tier2kp});
      dataRows.push({"value":item.tier3kp});
      dataRows.push({"value":item.tier4kp});
      dataRows.push({"value":item.tier5kp});
      dataRows.push({"value":item.dead});
      dataRows.push({"value":item.resourceAssistance});
    }

    const buffer = await writeXlsxFile(
      [HEADER_ROW, ...chunks(dataRows, HEADER_ROW.length)],
      {
        buffer: true,
      },
    );

    return interaction.followUp({
      files: [
        new AttachmentBuilder(buffer, {
          name: "kvk_dkp.xlsx",
          description: "KvK DKP export",
        }),
      ],
    });
  },
};
