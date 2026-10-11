SELECT
    T0.ItemCode AS Item_No,
    T0.Quantity AS Quantity,
    T0.PriceBefDi AS Unit_Price,
    T0.DiscPrcnt AS Discount_Percent,
    T0.TaxCode AS Tax_Code,
    T0.LineTotal AS Total_LC,
    T0.CountryOrg AS Country_Region_Of_Origin,
    T0.OcrCode AS Distr_Rule,
    T0.CogsOcrCod AS COGS_Distr_Rule,
    T0.LocCode AS Loc,
    T0.UomCode AS UoM_Code,
    T0.AgrNo AS Blanket_Agreement_No,
    COALESCE(CONVERT(NVARCHAR(100), T1.ChapterID), '') AS HSN,
    COALESCE(T2.ServCode, '') AS SAC,
    T0.U_S_BrokPerQty AS Comm_Amt_Per_Tone,
    T0.U_COMPRC AS Commission_Percent,
    T0.U_DocKey AS Sauda_Node_Ref,
    T0.U_ItemCode AS Item_Code,
    T0.U_Item_Desc AS Item_Description,
    T0.U_UoM AS Unit,
    T0.U_Order_Qty AS Order_Qty,
    T0.U_Rate AS Discount,
    T0.U_Amount AS Amount,
    T0.U_Disc_Rate AS Net_Rate,
    T0.U_Disc_Amount AS Taxable_Amount,
    T0.U_Com AS Commission,
    T0.U_comby AS Commission_By,
    T0.U_S_BrokPerQty AS Comm_Amt_Per_Tone_2,
    T0.U_Brok_Seller AS Commission_2
FROM DLN1 T0
LEFT JOIN OCHP T1 ON T1.AbsEntry = T0.HsnEntry
LEFT JOIN OSAC T2 ON T2.AbsEntry = T0.SacEntry
WHERE T0.DocEntry = {{docEntry}}
ORDER BY T0.LineNum
