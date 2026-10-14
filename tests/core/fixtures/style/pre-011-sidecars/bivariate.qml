<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
  <renderer-v2 type="RuleRenderer" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <rules key="{se-rules}">
      <rule filter="&quot;v&quot; &gt;= 0 AND &quot;v&quot; &lt;= 20.666666666666664 AND &quot;w&quot; &gt;= 0 AND &quot;w&quot; &lt;= 7.333333333333333" key="{se-cell:0-0}" label="0 – 21 · 0 – 7.3" symbol="0"/>
      <rule filter="&quot;v&quot; &gt; 20.666666666666664 AND &quot;v&quot; &lt;= 39.33333333333333 AND &quot;w&quot; &gt;= 0 AND &quot;w&quot; &lt;= 7.333333333333333" key="{se-cell:1-0}" label="21 – 39 · 0 – 7.3" symbol="1"/>
      <rule filter="&quot;v&quot; &gt; 39.33333333333333 AND &quot;v&quot; &lt;= 58 AND &quot;w&quot; &gt;= 0 AND &quot;w&quot; &lt;= 7.333333333333333" key="{se-cell:2-0}" label="39 – 58 · 0 – 7.3" symbol="2"/>
      <rule filter="&quot;v&quot; &gt;= 0 AND &quot;v&quot; &lt;= 20.666666666666664 AND &quot;w&quot; &gt; 7.333333333333333 AND &quot;w&quot; &lt;= 14.666666666666666" key="{se-cell:0-1}" label="0 – 21 · 7.3 – 14.7" symbol="3"/>
      <rule filter="&quot;v&quot; &gt; 20.666666666666664 AND &quot;v&quot; &lt;= 39.33333333333333 AND &quot;w&quot; &gt; 7.333333333333333 AND &quot;w&quot; &lt;= 14.666666666666666" key="{se-cell:1-1}" label="21 – 39 · 7.3 – 14.7" symbol="4" checkstate="0"/>
      <rule filter="&quot;v&quot; &gt; 39.33333333333333 AND &quot;v&quot; &lt;= 58 AND &quot;w&quot; &gt; 7.333333333333333 AND &quot;w&quot; &lt;= 14.666666666666666" key="{se-cell:2-1}" label="39 – 58 · 7.3 – 14.7" symbol="5"/>
      <rule filter="&quot;v&quot; &gt;= 0 AND &quot;v&quot; &lt;= 20.666666666666664 AND &quot;w&quot; &gt; 14.666666666666666 AND &quot;w&quot; &lt;= 22" key="{se-cell:0-2}" label="0 – 21 · 14.7 – 22" symbol="6"/>
      <rule filter="&quot;v&quot; &gt; 20.666666666666664 AND &quot;v&quot; &lt;= 39.33333333333333 AND &quot;w&quot; &gt; 14.666666666666666 AND &quot;w&quot; &lt;= 22" key="{se-cell:1-2}" label="21 – 39 · 14.7 – 22" symbol="7"/>
      <rule filter="&quot;v&quot; &gt; 39.33333333333333 AND &quot;v&quot; &lt;= 58 AND &quot;w&quot; &gt; 14.666666666666666 AND &quot;w&quot; &lt;= 22" key="{se-cell:2-2}" label="39 – 58 · 14.7 – 22" symbol="8"/>
      <rule filter="&quot;v&quot; IS NULL OR &quot;w&quot; IS NULL" key="{se-__null}" label="Missing" symbol="9"/>
    </rules>
    <symbols>
      <symbol type="fill" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="232,232,232,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="1" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="244,161,125,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="2" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="230,85,13,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="3" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="152,179,211,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="4" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="173,124,121,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="5" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="166,67,38,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="6" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="49,130,189,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="7" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="101,90,115,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="8" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="105,49,48,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
      <symbol type="fill" name="9" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="SimpleFill" enabled="1" locked="0" pass="0">
          <Option type="Map">
            <Option name="color" type="QString" value="140,140,140,191"/>
            <Option name="joinstyle" type="QString" value="round"/>
            <Option name="outline_color" type="QString" value="75,85,99,204"/>
            <Option name="outline_style" type="QString" value="solid"/>
            <Option name="outline_width" type="QString" value="0.5"/>
            <Option name="outline_width_unit" type="QString" value="Pixel"/>
            <Option name="style" type="QString" value="solid"/>
          </Option>
        </layer>
      </symbol>
    </symbols>
  </renderer-v2>
  <customproperties>
    <Option type="Map">
      <Option name="spatialExplorer/bivariate" type="QString" value="{&quot;kind&quot;:&quot;bivariate&quot;,&quot;x&quot;:{&quot;column&quot;:&quot;v&quot;,&quot;method&quot;:&quot;quantile&quot;},&quot;y&quot;:{&quot;column&quot;:&quot;w&quot;,&quot;method&quot;:&quot;equal&quot;},&quot;palette&quot;:&quot;orange-blue&quot;,&quot;hidden&quot;:[&quot;1-1&quot;],&quot;noValue&quot;:{&quot;label&quot;:&quot;Missing&quot;}}"/>
    </Option>
  </customproperties>
  <layerOpacity>1</layerOpacity>
  <layerGeometryType>2</layerGeometryType>
</qgis>
