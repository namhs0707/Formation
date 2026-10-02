<#!
.SYNOPSIS
    Creates the SharePoint columns required by the Formation Inspection app.

.DESCRIPTION
    This script is intentionally additive and idempotent: it creates missing
    columns only and never deletes or overwrites existing list data.

    The script opens Microsoft's interactive sign-in window. No password or
    access token is stored by this script.
#>

[CmdletBinding()]
param(
    [string]$SiteUrl = 'https://lgensol365.sharepoint.com/sites/ESHDFormationinspection',
    [string]$ListName = 'Self Inspection Records'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Module -ListAvailable -Name PnP.PowerShell)) {
    throw "PnP.PowerShell is not installed. Install it once with: Install-Module PnP.PowerShell -Scope CurrentUser"
}

Import-Module PnP.PowerShell
Connect-PnPOnline -Url $SiteUrl -Interactive

Get-PnPList -Identity $ListName | Out-Null

function Escape-Xml([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

function Ensure-Field {
    param(
        [Parameter(Mandatory)] [string]$DisplayName,
        [Parameter(Mandatory)] [string]$InternalName,
        [Parameter(Mandatory)] [string]$Type,
        [string[]]$Choices,
        [switch]$Multiple,
        [int]$Decimals = 0
    )

    $existing = Get-PnPField -List $ListName -Identity $InternalName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Exists: $DisplayName" -ForegroundColor DarkGray
        return
    }

    $display = Escape-Xml $DisplayName
    $internal = Escape-Xml $InternalName
    $attributes = @(
        "Type='$Type'",
        "DisplayName='$display'",
        "Name='$internal'",
        "StaticName='$internal'"
    )

    if ($Type -eq 'Note') {
        $attributes += "NumLines='6'"
        $attributes += "RichText='FALSE'"
    }
    elseif ($Type -eq 'Number') {
        $attributes += "Decimals='$Decimals'"
    }
    elseif ($Type -eq 'DateTime') {
        $attributes += "Format='DateTime'"
    }
    elseif ($Type -eq 'Choice') {
        $attributes += "FillInChoice='FALSE'"
        if ($Multiple) { $attributes += "Mult='TRUE'" }
    }

    $xml = "<Field $($attributes -join ' ')"
    if ($Type -eq 'Choice') {
        $xml += '><CHOICES>'
        foreach ($choice in $Choices) {
            $xml += "<CHOICE>$(Escape-Xml $choice)</CHOICE>"
        }
        $xml += '</CHOICES></Field>'
    }
    else {
        $xml += ' />'
    }

    Add-PnPFieldFromXml -List $ListName -FieldXml $xml | Out-Null
    Write-Host "Created: $DisplayName" -ForegroundColor Green
}

$processChoices = @(
    'Before HPCD', 'Jig Formation', 'Degas', 'HTA',
    'EOL Tape/Knife', 'Conductive Rubber', 'Start-up HPCD', 'Start-up Jig'
)
$teamChoices = @('1A', '1B', '2A', '2B')
$defectChoices = @('All OK', 'Dent', 'Contamination', 'Scratch', 'Lead bending', 'Wrinkles', 'Others')
$lineChoices = @('3-1', '3-2', '3-3', '4-1', '4-2', '4-3', '5-1', '5-2', '5-3', '6-1', '6-2', '6-3')
$startupStatusChoices = @('Pass', 'Flagged', 'Incomplete')

Ensure-Field -DisplayName 'Record Date' -InternalName 'RecordDate' -Type DateTime
Ensure-Field -DisplayName 'Process' -InternalName 'Process' -Type Choice -Choices $processChoices
Ensure-Field -DisplayName 'Team' -InternalName 'Team' -Type Choice -Choices $teamChoices
Ensure-Field -DisplayName 'Operator Name' -InternalName 'OperatorName' -Type Text
Ensure-Field -DisplayName 'Tray ID' -InternalName 'TrayID' -Type Text
Ensure-Field -DisplayName 'Cell ID' -InternalName 'CellID' -Type Text
Ensure-Field -DisplayName 'Channel' -InternalName 'Channel' -Type Number
Ensure-Field -DisplayName 'Defect Type' -InternalName 'DefectType' -Type Choice -Choices $defectChoices -Multiple
Ensure-Field -DisplayName 'Line' -InternalName 'InspectionLine' -Type Choice -Choices $lineChoices
Ensure-Field -DisplayName 'Hot Jig' -InternalName 'HotJig' -Type Number
Ensure-Field -DisplayName 'Comment' -InternalName 'Comment' -Type Note
Ensure-Field -DisplayName 'Defect Map' -InternalName 'DefectMap' -Type Note

Ensure-Field -DisplayName 'HTA 1-1' -InternalName 'HTA11' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 1-2' -InternalName 'HTA12' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 2-1' -InternalName 'HTA21' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 2-2' -InternalName 'HTA22' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 3-1' -InternalName 'HTA31' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 3-2' -InternalName 'HTA32' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 4-1' -InternalName 'HTA41' -Type Number -Decimals 2
Ensure-Field -DisplayName 'HTA 4-2' -InternalName 'HTA42' -Type Number -Decimals 2
Ensure-Field -DisplayName 'Temperature Result' -InternalName 'TemperatureResult' -Type Choice -Choices @('In Spec', 'Out of Spec')

Ensure-Field -DisplayName 'Equipment' -InternalName 'Equipment' -Type Choice -Choices @('Tape', 'Knife')
Ensure-Field -DisplayName 'Maintenance Action' -InternalName 'MaintenanceAction' -Type Choice -Choices @('Cleaning', 'Replace')
Ensure-Field -DisplayName 'Taping Line' -InternalName 'TapingLine' -Type Choice -Choices @('Both', 'A', 'B')

Ensure-Field -DisplayName 'Conductive Process' -InternalName 'ConductiveProcess' -Type Choice -Choices @('Degas', 'EOL')
Ensure-Field -DisplayName 'Measurement' -InternalName 'Measurement' -Type Choice -Choices @('IR', 'IV')
Ensure-Field -DisplayName 'Units' -InternalName 'Units' -Type Text
Ensure-Field -DisplayName 'Conductive Action' -InternalName 'ConductiveAction' -Type Choice -Choices @('Flip', 'Change', 'Other')

Ensure-Field -DisplayName 'Check Type' -InternalName 'CheckType' -Type Choice -Choices @('Start-up HPCD', 'Start-up Jig')
Ensure-Field -DisplayName 'Startup Lines' -InternalName 'StartupLines' -Type Text
Ensure-Field -DisplayName 'Check Completed' -InternalName 'CheckCompleted' -Type Choice -Choices @('Yes', 'No')
Ensure-Field -DisplayName 'Frequency' -InternalName 'Frequency' -Type Choice -Choices @('Shift', 'Weekly', 'Monthly')
Ensure-Field -DisplayName 'Startup Category' -InternalName 'StartupCategory' -Type Text
Ensure-Field -DisplayName 'Startup Item' -InternalName 'StartupItem' -Type Text
Ensure-Field -DisplayName 'Startup Status' -InternalName 'StartupStatus' -Type Choice -Choices $startupStatusChoices
Ensure-Field -DisplayName 'Startup Comment' -InternalName 'StartupComment' -Type Note

Write-Host ''
Write-Host "SharePoint columns are ready: $ListName" -ForegroundColor Cyan
Disconnect-PnPOnline
