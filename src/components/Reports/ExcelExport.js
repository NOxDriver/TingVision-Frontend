import React from 'react';
import Button from '@mui/material/Button';
import * as FileSaver from 'file-saver';
import XLSX from 'sheetjs-style';
import { Tooltip } from '@mui/material';

const ExportExcel = ({ excelData, fileName }) => {

    const fileType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8';
    const fileExtension = '.xlsx';


    const exportToExcel = async () => {

        // Sort by earnings
        excelData.sort((a, b) => b.earnings - a.earnings);


        // If the earnings are duplicates, add a key to the object that says true
        excelData.forEach((a, i) => {
            excelData.forEach((b, j) => {
                if (i !== j && a.earnings === b.earnings) {
                    a.duplicate = true;
                    b.duplicate = true;
                    if (a.earnings !== 0) b.earnings = 'ignored';
                }
            });
        });

        excelData.forEach(a => {

            a['Title'] = a.videoTitle;
            a['Estimated Earnings (USD)'] = a.earnings;

            delete a.videoTitle;
            console.log('a.Dailed', a.failed);
            delete a.failed;
            console.log('a.videoId', a.videoId);
            delete a.videoId;
            console.log('a.errorMessage', a.errorMessage);
            delete a.errorMessage;
            delete a.updatedAt;
            delete a.publishedAt;
            delete a.videoLink;
            delete a.videoThumbnail;
            if (!isNaN(a.id[0])) a.id = `'${a.id}`;
            a['Video asset ID'] = a.id;
            console.log("a['Video asset ID']", a['Video asset ID']);
            delete a.id;
            // Add column for what to pay the client
            a.clientPayment =
                !isNaN(a.earnings) ? a.earnings * (a.percentageToClient) / 100 : 'ignored';
            // If more than one tag, separate into different columns
            if (Array.isArray(a?.tags) && a?.tags.length > 0) {
                console.log('a.tags', a.tags);
                a.tags.forEach((t, i) => {
                    console.log('i', i);
                    console.log('t', t);
                    a[`tag${i + 1}`] = t;
                    console.log('a', a[`tag${i + 1}`]);
                });
            }
            delete a.earnings;
            delete a.tags;
        });

        // const cleanedData = excelData.filter((v, i, a) => a.findIndex(t => (t.earnings === v.earnings)) === i);


        // Delete the 0 earnings
        // excelData = excelData.filter(a => a.earnings !== 0);

        const ws = XLSX.utils.json_to_sheet(excelData, { header: ['Video asset ID', 'Title', 'percentageToClient', 'Estimated Earnings (USD)', 'clientPayment', 'views', 'likes'] }, { skipHeader: true });
        // Drop the other columns
        ws['!cols'] = [
            { wch: 20 },
            { wch: 20 },
            { wch: 20 },
            { wch: 20 },
            { wch: 20 },
            { wch: 20 },
            { wch: 20 },
        ];
        const wb = { Sheets: { 'data': ws }, SheetNames: ['data'] };
        const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const data = new Blob([excelBuffer], { type: fileType });
        FileSaver.saveAs(data, fileName + fileExtension);
    }

    console.log('excelData: ', excelData);
    console.log('fileName: ', fileName);
    return (
        <>
            <Tooltip title="Export to Excel">
                <Button
                    variant="contained"
                    color="primary"
                    onClick={(e) => exportToExcel(fileName)}
                    style={{ cursor: "pointer", fontSize: 14 }}
                >
                    Excel Export
                </Button>

            </Tooltip>
        </>
    );
}

export default ExportExcel;

